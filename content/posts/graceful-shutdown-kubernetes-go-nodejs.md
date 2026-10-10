---
title: "Graceful Shutdown in Kubernetes for Go and Node.js Services"
date: 2026-10-08
category: "Reliability"
tag: "Kubernetes Operations"
tags: ["Kubernetes", "Go", "Node.js", "Graceful Shutdown", "Deployments"]
image: "img/blog/graceful-shutdown-kubernetes-go-nodejs.jpg"
featured: false
description: "Why rolling deploys drop requests, how Kubernetes pod termination really works, and a step-by-step graceful shutdown for Go and Node.js services."
---

Does your error rate tick up a little on every deploy? That's probably not a bug in the new version. It's a shutdown problem. A handful of `502`s and connection resets per rollout is so common that lots of teams treat it as normal. It isn't, and the fix is mostly plumbing.

## What actually happens when a pod is terminated

When Kubernetes stops a pod (a rollout, a scale-down, a node drain), two things start *at the same time*:

1. The kubelet begins shutting down the containers: it runs the `preStop` hook if there is one, then sends `SIGTERM`.
2. The control plane removes the pod from the Service's endpoints, and that change propagates to kube-proxy, ingress controllers, and service meshes across the cluster.

The second path is slow. It can take anywhere from milliseconds to a few seconds before every load balancer stops sending the pod traffic. Exit as soon as `SIGTERM` arrives and the requests still being routed your way hit a closed port.

After `terminationGracePeriodSeconds` (30 seconds by default, and the `preStop` hook counts against it), anything still running gets `SIGKILL`.

## The shutdown sequence that works

1. Keep serving for a few seconds after termination starts, so load balancers catch up.
2. Stop accepting new connections and let in-flight requests finish.
3. Stop background work like consumers and schedulers, finishing or handing off what's in progress.
4. Flush and close producers, database pools, and telemetry.
5. Exit before the grace period runs out.

Step 1 is the one everyone skips. The simplest version is a short sleep in a `preStop` hook:

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

That needs a `sleep` binary in the image. Distroless images don't have one, so either delay inside your app after `SIGTERM`, or use the built-in `sleep` action for `preStop` that newer Kubernetes versions support.

The grace period has to cover the pre-stop delay, your longest realistic request, and cleanup.

## Go

The standard library covers it. `signal.NotifyContext` gives you a context that's cancelled on `SIGTERM`, and `http.Server.Shutdown` stops accepting connections and waits for active requests:

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

The shutdown context comes from `context.Background()`, not the cancelled signal context. Otherwise it would already be done.

Handlers need to respect their own context too. `Shutdown` waits for them to return, and one handler stuck on a call with no timeout holds the whole shutdown until `SIGKILL`.

## Node.js

Same pattern, plus a few Node-specific details:

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

What usually goes wrong in Node:

- **The process never gets the signal.** Start the container with `npm start` or a shell-form `CMD` and the signal may go to `npm` or `sh` instead. Run `node` directly with the exec form (`CMD ["node", "server.js"]`), or use a small init like `tini`. It catches a lot of people.
- **Keep-alive connections hold the server open.** `server.close()` waits for every connection to end, and idle keep-alive sockets can sit there a long time. That's what `closeIdleConnections()` (Node 18.2+) is for. From Node 19, `server.close()` closes idle connections itself, so the extra call mostly matters on Node 18.
- **Work still running after close.** Timers and intervals can keep the process alive or run against closed resources. Clear them during shutdown.

## Kafka consumers

A sloppy consumer shutdown either loses progress or causes a slow rebalance.

Stop polling, finish the current batch, commit, then close. A clean close sends a leave-group request, so the group rebalances right away instead of waiting out the session timeout. Don't commit offsets for work you didn't finish; if you run out of time, let it be redelivered. That's what [idempotent consumers](/posts/transactional-outbox-idempotent-consumers/) are for. And with static membership, a quick restart can rejoin without any rebalance at all, which I covered in [Kafka at scale](/posts/kafka-at-scale-partitions-consumers-rebalancing/).

## Readiness and the rest of the probes

- Fail readiness when shutdown starts. It's a useful extra signal, but it doesn't replace the pre-stop delay, since endpoint removal is already underway.
- Don't fail liveness during shutdown. That can trigger a restart in the middle of a graceful exit.
- Check `maxUnavailable` and `maxSurge` on the Deployment, and add a PodDisruptionBudget so node drains don't take out too many replicas at once.

## How to test it

I wouldn't trust any of this until I'd seen it hold up under load:

1. Run a steady load test against the service, with a few hundred requests per second.
2. Trigger a rollout with `kubectl rollout restart deployment/api`.
3. Count non-2xx responses and connection errors during the rollout.

Aim for zero. A burst right as a pod starts terminating means the pre-stop delay is too short. Errors at the end mean the grace period, or the app's own shutdown timeout, is too short.

<!-- TODO(Manas): optional, add a line on what this looked like in your own deployments, e.g. errors per rollout before and after adding the pre-stop delay. -->

## Takeaways

- Endpoint removal and `SIGTERM` happen in parallel. Keep serving briefly after termination starts.
- Then stop accepting, drain, close consumers and producers, and exit within the grace period.
- Go: `signal.NotifyContext` plus `http.Server.Shutdown` with a fresh timeout context.
- Node: make sure the signal actually reaches the process, and close idle keep-alive connections.
- Test with a real rollout under load.
