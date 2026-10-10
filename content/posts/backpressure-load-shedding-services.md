---
title: "Backpressure and Load Shedding: Keeping Services Alive Under Overload"
date: 2026-10-06
category: "Reliability"
tag: "Overload Protection"
tags: ["Reliability", "Go", "Node.js", "Backpressure", "Load Shedding", "Little's Law"]
image: "img/blog/backpressure-load-shedding-services.jpg"
featured: false
description: "Why unbounded queues turn overload into outages, how Little's Law explains it, and practical ways to add backpressure, concurrency limits, and load shedding to Go and Node.js services."
---

Most services don't fail because they get a bit more traffic than they can handle. They fail because they *accept* that traffic, queue it up, and then serve every request slowly instead of serving most requests quickly. Latency climbs, clients time out and retry, the queue grows faster, and soon the service is doing a lot of work for requests nobody is waiting for anymore.

The fix is counterintuitive: to stay up under overload, a service has to say no to some work, early and cheaply.

## Little's Law, in one paragraph

Little's Law says that for a stable system:

> items in the system = arrival rate × time each item spends in the system

If your service handles 1,000 requests per second and each takes 50ms, there are about 50 requests in flight at any time. Now suppose a database slows down and requests take 500ms. At the same arrival rate, you now have 500 in flight. Ten times the memory, ten times the open connections, ten times the goroutines or pending promises. Nothing about the traffic changed. Latency did, and concurrency followed.

That's why overload usually starts with *latency*, not traffic. And it's why an unbounded queue is so dangerous: it lets in-flight work grow without limit, hiding the problem until memory or file descriptors run out.

## Backpressure: push the "slow down" upstream

**Backpressure** means that when a stage can't keep up, it makes the stage before it slow down instead of buffering without limit. The building block is a bounded queue that blocks or rejects when it's full.

In Go, a buffered channel is a bounded queue:

```go
jobs := make(chan Job, 256)

// producer side: wait for space, but not forever
select {
case jobs <- job:
	// accepted
case <-ctx.Done():
	return ctx.Err()
}
```

When the channel is full, the sender waits. If the sender is a Kafka consumer, it stops polling and the backlog stays in Kafka, where it's durable and cheap. I used exactly this idea in the [Go Kafka pipelines](/posts/go-kafka-event-streams/) post.

In Node.js, streams have backpressure built in, but only if you respect it. `writable.write()` returns `false` when the internal buffer is full, and you're supposed to wait for `'drain'`. Ignoring that return value is a classic way to buffer a whole file in memory. Using `stream.pipeline()` handles it for you:

```js
const { pipeline } = require('node:stream/promises');

await pipeline(
  fs.createReadStream('big-export.csv'),
  transformRows(),
  zlib.createGzip(),
  res,
);
```

## Concurrency limits

For request-serving services, backpressure usually means capping in-flight work. A semaphore is enough:

```go
type Limiter struct{ sem chan struct{} }

func NewLimiter(n int) *Limiter { return &Limiter{sem: make(chan struct{}, n)} }

func (l *Limiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case l.sem <- struct{}{}:
			defer func() { <-l.sem }()
			next.ServeHTTP(w, r)
		default:
			w.Header().Set("Retry-After", "1")
			http.Error(w, "overloaded", http.StatusServiceUnavailable)
		}
	})
}
```

The important part is the `default` branch. When the limit is reached, the request is rejected immediately. That costs microseconds. Accepting it and timing out 10 seconds later costs memory, a connection, and a frustrated client who retries anyway.

How do you pick the limit? Little's Law again: limit ≈ target throughput × normal latency, with some headroom. If you want something that adapts on its own, look at adaptive concurrency limits, like Netflix's `concurrency-limits` library, which adjust the limit based on observed latency, similar to TCP congestion control.

## Load shedding: decide what to drop

Once you're rejecting work, you get to choose *which* work. Some approaches:

- **Shed by priority.** Health checks, payments, and logged-in users first; analytics beacons and prefetch requests go first when it's tight.
- **Shed stale work.** If a request has been queued longer than the client's timeout, the client has already given up. Drop it before doing any work. Checking `ctx.Err()` before starting expensive steps is a cheap way to do this in Go.
- **Prefer LIFO under overload.** It sounds unfair, but when the queue is long, the newest requests are the ones whose clients are still waiting. Some systems switch from FIFO to LIFO when the queue passes a threshold for exactly this reason.
- **Shed on a health signal.** In Node.js, event loop lag is an excellent overload signal. When it crosses a threshold, reject new requests until it recovers. I cover this in [event loop lag and CPU throttling](/posts/nodejs-event-loop-lag-cpu-throttling/).

## Reject well

How you say no matters as much as saying it:

- **Fail fast.** Rejection should be cheap: no database calls, no heavy logging per rejected request.
- **Use the right status.** `503 Service Unavailable` or `429 Too Many Requests`, with a `Retry-After` header.
- **Make sure clients back off.** A `503` that clients retry immediately makes things worse. This is where [retries with backoff and jitter](/posts/timeouts-retries-backoff/) and retry budgets come in.
- **Keep the health check honest.** If load shedding kicks in, a readiness probe can take the instance out of rotation briefly. Don't let liveness probes restart overloaded pods, which moves their load onto the survivors.

## Don't forget the queues you didn't write

Unbounded queues hide in plenty of places besides your own code:

- **Connection pools.** Many database pools queue callers indefinitely when all connections are busy. Set an acquire timeout.
- **Thread pools.** Node's libuv pool queues `fs`, `dns.lookup`, and crypto work without limit.
- **Load balancers and proxies.** Check their queue and timeout settings so a request doesn't wait in a proxy longer than the client will.
- **Kafka consumers.** Prefetch settings decide how much data sits in memory per consumer.

Each one should have a bound and a timeout. Otherwise, it's where your latency goes to hide.

## Takeaways

- Overload usually starts as a latency increase, and Little's Law turns that into more in-flight work.
- Bound every queue. Let backpressure push slowdowns upstream to somewhere durable.
- Cap concurrency and reject excess work immediately with `503` or `429` and `Retry-After`.
- Shed low-priority and stale work first.
- Make sure clients back off, and keep liveness probes out of overload handling.
