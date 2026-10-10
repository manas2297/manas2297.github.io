---
title: "Backpressure and Load Shedding: Keeping Services Alive Under Overload"
seoTitle: "Backpressure and Load Shedding for Go and Node.js Services"
date: 2026-10-06
category: "Reliability"
tag: "Overload Protection"
tags: ["Reliability", "Go", "Node.js", "Backpressure", "Load Shedding", "Little's Law"]
image: "img/blog/backpressure-load-shedding-services.jpg"
featured: false
description: "Why unbounded queues turn overload into outages, and how to add backpressure, concurrency limits, and load shedding to Go and Node.js services."
---

Services rarely die from a bit more traffic than they can handle. They die because they *accept* that traffic, queue it up, and then serve every request slowly instead of serving most of them quickly. Latency climbs. Clients time out and retry, the queue grows faster, and before long the service is busy working on requests nobody is waiting for anymore.

The fix feels backwards: to stay up under overload, a service has to say no to some work, early and cheaply.

## Little's Law, in one paragraph

Little's Law says that for a stable system:

> items in the system = arrival rate × time each item spends in the system

If your service handles 1,000 requests per second and each takes 50ms, there are about 50 requests in flight at any time. Now the database slows down and requests take 500ms. Same arrival rate, but 500 in flight. That's ten times the memory and open connections, and ten times the goroutines or pending promises. The traffic didn't change at all. Latency did, and concurrency followed it.

So overload usually starts with *latency*, not traffic. That's also why unbounded queues are so dangerous. They let in-flight work grow without limit and hide the problem until you run out of memory or file descriptors.

## Backpressure: push the "slow down" upstream

Backpressure means that when a stage can't keep up, it makes the stage before it slow down instead of buffering without limit. The building block is a bounded queue that blocks or rejects when it's full.

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

Node.js streams have backpressure built in, but only if you respect it. `writable.write()` returns `false` when the internal buffer is full, and you're supposed to wait for `'drain'`. Ignore that return value and you'll end up buffering a whole file in memory. I've seen this a lot. `stream.pipeline()` handles it for you:

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

The `default` branch is what matters. Once the limit is reached, the request is rejected on the spot, which costs microseconds. Accepting it and timing out 10 seconds later costs memory and a connection, and the client retries anyway.

Picking the limit is Little's Law again: limit ≈ target throughput × normal latency, plus some headroom. If you'd rather not hand-tune it, adaptive concurrency limits (Netflix's `concurrency-limits` library is the well-known one) adjust the limit from observed latency, a bit like TCP congestion control.

## Load shedding: decide what to drop

Once you're rejecting work, you get to pick *which* work.

- **Shed by priority.** Health checks, payments, and logged-in users get served; analytics beacons and prefetch requests are the first to go when it's tight.
- **Shed stale work.** If a request has sat in a queue longer than the client's timeout, the client has already given up. Drop it before doing anything. In Go, checking `ctx.Err()` before expensive steps is a cheap way to do this.
- **Prefer LIFO under overload.** Sounds unfair. But when the queue is long, the newest requests are the ones whose clients are still waiting, and some systems switch from FIFO to LIFO past a queue threshold for exactly that reason.
- **Shed on a health signal.** For Node.js, event loop lag is a very good overload signal: past a threshold, reject new requests until it recovers. More on that in [event loop lag and CPU throttling](/posts/nodejs-event-loop-lag-cpu-throttling/).

## Reject well

How you say no matters nearly as much as saying it.

- Rejection has to be cheap. No database calls, no heavy logging per rejected request.
- Use `503 Service Unavailable` or `429 Too Many Requests`, with a `Retry-After` header.
- Make sure clients actually back off. A `503` that gets retried immediately makes things worse, which is where [retries with backoff and jitter](/posts/timeouts-retries-backoff/) and retry budgets come in.
- Keep health checks honest. A readiness probe can take a shedding instance out of rotation briefly. Liveness probes should never restart overloaded pods; that just dumps their load on the survivors. This one bites people.

## Don't forget the queues you didn't write

Unbounded queues hide in plenty of places outside your own code:

- **Connection pools.** Many database pools queue callers indefinitely when all connections are busy. Set an acquire timeout.
- **Thread pools.** Node's libuv pool queues `fs`, `dns.lookup`, and crypto work without limit.
- **Load balancers and proxies.** Check their queue and timeout settings so a request doesn't wait in a proxy longer than the client will.
- **Kafka consumers.** Prefetch settings decide how much data sits in memory per consumer.

Each one needs a bound and a timeout. Otherwise it's where your latency goes to hide.

If you take one thing from this post: bound every queue you own, and find the ones you don't. Most overload incidents I'd call avoidable come down to some buffer that was allowed to grow until the process fell over.
