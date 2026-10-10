---
title: "Graceful Shutdown in Kubernetes for Go and Node.js Services"
date: 2026-10-08
category: "Reliability"
tag: "Kubernetes Operations"
tags: ["Kubernetes", "Go", "Node.js", "Graceful Shutdown", "Deployments"]
image: "img/blog/graceful-shutdown-kubernetes-go-nodejs.jpg"
featured: false
description: "Why rolling deploys drop requests even with readiness probes, how pod termination really works, and a step-by-step graceful shutdown for Go and Node.js services, including Kafka consumers."
---

If your error rate ticks up a little every time you deploy, you probably don't have a bug in the new version. You have a shutdown problem. A handful of `502`s and connection resets per rollout is so common that many teams treat it as normal. It isn't, and the fix is mostly well-understood plumbing.

## What actually happens when a pod is terminated

When Kubernetes decides to stop a pod (a rollout, a scale-down, a node drain), two things start **at the same time**:

1. The kubelet begins shutting down the containers: it runs the `preStop` hook if there is one, then sends `SIGTERM`.
2. The control plane removes the pod from the Service's endpoints, and that change propagates to kube-proxy, ingress controllers, and service meshes across the cluster.

The second path takes time. It can be anywhere from milliseconds to a few seconds before every load balancer stops sending traffic to the pod. If your process exits as soon as it gets `SIGTERM`, requests that are still being routed to it hit a closed port.

After `terminationGracePeriodSeconds` (30 seconds by default, and the `preStop` hook counts against it), anything still running gets `SIGKILL`.

## The shutdown sequence that works

1. **Keep serving for a few seconds** after termination starts, so load balancers catch up.
2. **Stop accepting new connections**, and let in-flight requests finish.
3. **Stop background work** like consumers and schedulers, finishing or handing off what's in progress.
4. **Flush and close** producers, database pools, and telemetry.
5. **Exit** before the grace period runs out.

The first step is the one people skip. The simplest way to do it is a short sleep in a `preStop` hook:

```yaml
spec:
  terminationGracePeriodSeconds: 45
  containers:
    - name: api
      lifecycle:
        preStop:
          exec:
            command: ["sleep", "5"]
```

This needs a `sleep` binary in the image. Distroless images don't have one, so either do the delay inside your app after `SIGTERM`, or use the built-in `sleep` action for `preStop` that newer Kubernetes versions support.

Make sure the grace period covers the pre-stop delay plus your longest realistic request plus cleanup.

## Go

The standard library has everything you need. `signal.NotifyContext` gives you a context that's cancelled on `SIGTERM`, and `http.Server.Shutdown` stops accepting connections and waits for active requests:

```go
func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	srv := &http.Server{Addr: ":8080", Handler: router()}

	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %v", err)
		}
	}()

	<-ctx.Done() // SIGTERM received
	log.Println("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("http shutdown: %v", err)
	}
	consumer.Close()          // stop fetching, commit offsets, leave the group
	producer.Flush(shutdownCtx)
	db.Close()
}
```

Note that the shutdown context is built from `context.Background()`, not the cancelled signal context. Otherwise it would already be done.

Also make sure request handlers respect their own context. `Shutdown` waits for handlers to return. A handler stuck on a call with no timeout will hold the whole shutdown until `SIGKILL`.

## Node.js

The pattern is the same, with a couple of Node-specific details:

```js
const server = app.listen(8080);
let shuttingDown = false;

app.get('/readyz', (req, res) => res.status(shuttingDown ? 503 : 200).end());

process.on('SIGTERM', async () => {
  shuttingDown = true;

  // stop accepting new connections; resolves once existing ones finish
  const closed = new Promise((resolve) => server.close(resolve));
  server.closeIdleConnections();   // don't wait on idle keep-alive sockets

  const force = setTimeout(() => process.exit(1), 25_000);
  force.unref();

  await closed;
  await consumer.disconnect();
  await producer.disconnect();
  await pool.end();
  process.exit(0);
});
```

Things that commonly go wrong in Node:

- **Your process never receives the signal.** If your container starts with `npm start` or a shell-form `CMD`, the signal may go to `npm` or `sh` and never reach Node. Run `node` directly with the exec form (`CMD ["node", "server.js"]`), or use a small init like `tini`.
- **Keep-alive connections keep the server open.** `server.close()` waits for every connection to end. Idle keep-alive sockets can hold it for a long time, which is what `closeIdleConnections()` (Node 18.2+) is for.
- **Unhandled promise work after close.** Timers and intervals can keep the process alive or run against closed resources. Clear them as part of shutdown.

## Kafka consumers

Consumers deserve special attention, because a sloppy shutdown either loses progress or causes a slow rebalance:

- **Stop polling, finish the current batch, commit, then close.** Closing the consumer cleanly sends a leave-group request, so the group rebalances right away instead of waiting for the session timeout.
- **Don't commit offsets for work you didn't finish.** If you can't finish in time, let it be redelivered. That's what [idempotent consumers](/posts/transactional-outbox-idempotent-consumers/) are for.
- **With static membership**, a quick restart can rejoin without any rebalance at all. I covered that in [Kafka at scale](/posts/kafka-at-scale-partitions-consumers-rebalancing/).

## Readiness and the rest of the probes

- **Fail readiness when shutdown starts.** It's a useful extra signal, though it doesn't replace the pre-stop delay, because endpoint removal is already underway.
- **Don't fail liveness during shutdown.** A liveness failure can trigger a restart in the middle of a graceful exit.
- **Watch `maxUnavailable` and `maxSurge`** on the Deployment, and use a PodDisruptionBudget so node drains don't take down too many replicas at once.

## How to test it

Don't trust it until you've seen it hold up under load:

1. Run a steady load test against the service, with a few hundred requests per second.
2. Trigger a rollout with `kubectl rollout restart deployment/api`.
3. Count non-2xx responses and connection errors during the rollout.

The goal is zero. If you see a burst at the very start of a pod's termination, the pre-stop delay is too short. If you see errors at the end, the grace period or the app's own shutdown timeout is too short.

<!-- TODO(Manas): optional, add a line on what this looked like in your own deployments, e.g. errors per rollout before and after adding the pre-stop delay. -->

## Takeaways

- Endpoint removal and `SIGTERM` happen in parallel. Keep serving briefly after termination starts.
- Then stop accepting, drain in-flight work, close consumers and producers, and exit within the grace period.
- In Go, use `signal.NotifyContext` and `http.Server.Shutdown` with a fresh timeout context.
- In Node, make sure the signal reaches the process, and close idle keep-alive connections.
- Test with a real rollout under load, and aim for zero errors.
