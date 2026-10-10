---
title: "Node.js Event Loop Internals: What Actually Runs When"
date: 2026-08-26
category: "Performance"
tag: "Node.js Internals"
tags: ["Node.js", "libuv", "Event Loop", "Performance"]
image: "img/blog/nodejs-event-loop-internals.jpg"
featured: false
description: "A practical tour of the Node.js event loop: libuv phases, microtasks vs process.nextTick, the libuv thread pool, and the mistakes that block every request in your service."
---

"Node is single-threaded" is one of those statements that's true enough to repeat and wrong enough to cause outages. Your JavaScript runs on one thread. Node itself doesn't. Understanding where that line sits is the difference between a service that handles 10k concurrent connections calmly and one that falls over the first time someone uploads a big JSON file.

This post goes through what the event loop actually does, in the order it does it, and then the handful of mistakes that block it.

## The pieces

There are three main actors:

- **V8** runs your JavaScript and owns the call stack and the heap.
- **libuv** is the C library underneath Node. It owns the event loop, talks to the OS for non-blocking network I/O (epoll on Linux, kqueue on macOS, IOCP on Windows), and runs a small **thread pool** for work the OS can't do asynchronously.
- **Node's bindings** glue the two together, and add their own queues for `process.nextTick` and promise microtasks.

Network sockets don't use the thread pool. When you make 5,000 outbound HTTP calls, there aren't 5,000 threads anywhere. The OS tells libuv when sockets are readable or writable, and libuv calls back into JavaScript.

## The phases of one loop iteration

Each turn of the loop walks through a fixed set of phases. Each phase has a queue of callbacks:

1. **Timers.** Runs callbacks from `setTimeout` and `setInterval` whose time has come. A timer's delay is a minimum, not a promise.
2. **Pending callbacks.** Some I/O callbacks deferred from the previous iteration, like certain TCP errors.
3. **Idle / prepare.** Internal housekeeping.
4. **Poll.** The heart of the loop. libuv asks the OS for I/O events and runs their callbacks: incoming requests, data on sockets, completed file reads. If there's nothing else to do, the loop waits here for I/O, up to the time the next timer is due.
5. **Check.** Runs `setImmediate` callbacks.
6. **Close callbacks.** Things like `socket.on('close')`.

Then it starts again. If there are no more active handles or requests (no servers listening, no timers, no pending I/O), the process exits.

## Microtasks and `process.nextTick`

The phase list doesn't mention promises, and that's the source of a lot of confusion. Promise callbacks and `process.nextTick` callbacks aren't phases. They are drained **after every single callback** the loop runs, before moving to the next one.

The order is:

1. The `process.nextTick` queue, fully drained.
2. The promise microtask queue, fully drained.
3. Repeat if either queue got new items.

```js
setTimeout(() => console.log('timeout'), 0);
setImmediate(() => console.log('immediate'));
Promise.resolve().then(() => console.log('promise'));
process.nextTick(() => console.log('nextTick'));
console.log('sync');
```

This prints `sync`, `nextTick`, `promise`, and then `timeout` and `immediate`. The last two can swap places when run from the main module, because it depends on whether the 1ms minimum timer has elapsed by the time the loop starts. Inside an I/O callback, `setImmediate` always runs first, since the check phase comes right after poll.

The practical danger: because microtasks drain completely before the loop moves on, a recursive chain of `process.nextTick` or promise callbacks can **starve I/O entirely**. The loop never reaches the poll phase, so no new requests get read. A `setImmediate` doesn't have that problem, because it yields back to the loop.

## The thread pool, and why it's only 4 threads

Some work can't be done with non-blocking OS APIs, so libuv hands it to a thread pool. The pool has **4 threads by default** (`UV_THREADPOOL_SIZE`, which can be raised up to 1024). Things that use it include:

- Most of `fs` (file reads and writes)
- `dns.lookup`, which is what `http.get` uses by default to resolve hostnames
- Async `crypto` like `pbkdf2`, `scrypt`, and `randomBytes`
- `zlib` compression

That default is small, and it's shared. If your service hashes passwords with `scrypt` and also resolves hostnames with `dns.lookup`, a burst of logins can queue up DNS lookups behind password hashing. Outbound HTTP calls start to look slow, but the network is fine. They're waiting for a pool thread.

If you depend heavily on these APIs, set `UV_THREADPOOL_SIZE` explicitly, as an environment variable before the process starts. And remember that `dns.resolve*` uses c-ares and doesn't touch the pool, while `dns.lookup` does.

## What actually blocks the loop

Everything above is fine as long as each callback is quick. The loop is cooperative: while one callback runs, nothing else does. No timers fire, no sockets are read, no health checks answer. The usual offenders:

- **`JSON.parse` / `JSON.stringify` on big payloads.** Parsing a 50 MB body is pure synchronous CPU.
- **Sync APIs.** `fs.readFileSync`, `crypto.pbkdf2Sync`, `zlib.gzipSync`. Fine at startup, a problem inside a request handler.
- **Catastrophic regex backtracking.** A badly written regex against user input can take seconds. This is a known DoS vector, often called ReDoS.
- **Big loops over in-memory data.** Sorting or transforming 500k records in one go.
- **Heavy logging.** Synchronous serialization of large log objects on every request adds up fast.

The fixes fall into a few buckets: stream instead of buffering, move CPU-heavy work to `worker_threads`, break long loops into chunks with `setImmediate` between them, and put size limits on request bodies.

## How to know if it's happening

You can't reason your way to a blocked event loop from request latency alone. Slow requests could be slow downstreams, slow DNS, or a saturated pool. You need a direct measurement of how long the loop is taking to come back around. That measurement is **event loop lag** (or event loop delay), and it's one of the most useful signals a Node service can export.

I cover how to measure it, how to read it, and how it interacts with Kubernetes CPU limits in the follow-up: [Event loop lag as a performance signal](/posts/nodejs-event-loop-lag-cpu-throttling/).

## Takeaways

- Your JavaScript runs on one thread. libuv uses the OS for network I/O and a 4-thread pool for files, DNS lookups, crypto, and zlib.
- The loop runs timers, then pending callbacks, poll, check, and close callbacks, in that order.
- `process.nextTick` and promise callbacks drain after every callback, and can starve I/O if they never stop.
- Anything synchronous and slow in a callback stalls every request in the process.
