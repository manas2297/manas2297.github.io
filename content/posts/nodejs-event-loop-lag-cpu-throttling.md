---
title: "Event Loop Lag in Node.js: Using It to Debug Performance and CPU Throttling"
date: 2026-09-02
category: "Performance"
tag: "Node.js Performance"
tags: ["Node.js", "Event Loop", "Kubernetes", "CPU Throttling", "Observability"]
image: "img/blog/nodejs-event-loop-lag-cpu-throttling.jpg"
featured: true
description: "How to measure Node.js event loop lag with perf_hooks, read it alongside event loop utilization, and use it to tell CPU-bound code apart from Kubernetes CFS throttling and GC pauses."
---

When a Node.js service gets slow, the first instinct is to look at request latency and downstream calls. That's useful, but it misses the most common Node-specific failure: the event loop itself falling behind. When it does, *every* request in the process gets slower at once, including ones that do nothing expensive.

Event loop lag is the metric that catches this. It's cheap to collect, easy to read once you know the patterns, and it's one of the best tools I know for spotting something dashboards usually hide: CPU throttling in containers.

If you want a refresher on how the loop works first, start with [Node.js event loop internals](/posts/nodejs-event-loop-internals/).

## What event loop lag measures

The idea is simple. Schedule a timer to fire in 10ms. Measure when it actually fires. If it fires at 10ms, the loop was free. If it fires at 250ms, something kept the loop busy (or kept the process off the CPU) for about 240ms. During that window, no other callback in the process could run.

Lag is a measure of *how long a ready-to-run callback has to wait*. It's the queueing delay that every request in the process pays, on top of its own work.

## Measuring it properly

Don't write the `setTimeout` trick yourself. Node ships a histogram-based monitor in `perf_hooks` that samples at a fixed resolution and gives you percentiles:

```js
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');

const lag = monitorEventLoopDelay({ resolution: 10 });
lag.enable();

let lastELU = performance.eventLoopUtilization();

setInterval(() => {
  const now = performance.eventLoopUtilization();
  const elu = performance.eventLoopUtilization(now, lastELU); // delta since last tick
  lastELU = now;

  metrics.gauge('eventloop_lag_p99_ms', lag.percentile(99) / 1e6);
  metrics.gauge('eventloop_lag_max_ms', lag.max / 1e6);
  metrics.gauge('eventloop_utilization', elu.utilization);

  lag.reset();
}, 10_000).unref();
```

Two notes:

- The histogram reports **nanoseconds**, hence the division.
- **Watch p99 and max, not the mean.** A loop that's fine 99% of the time and stalls for 400ms every few seconds has a lovely mean and a terrible user experience.

If you use `prom-client`, `collectDefaultMetrics()` already exports `nodejs_eventloop_lag_p99_seconds` and friends, so you may already have this data and not be looking at it.

## Its partner metric: event loop utilization

Lag alone tells you *that* the loop was delayed. **Event loop utilization (ELU)** tells you how much of the time the loop was actually busy running your code versus sitting idle waiting for I/O. It's a number between 0 and 1.

Reading the two together is where it gets useful:

| Lag | ELU | Most likely cause |
|---|---|---|
| Low | Low | Healthy. Slowness is elsewhere (downstreams, DB, network). |
| High | High (near 1) | CPU-bound JavaScript. Your code is doing too much on the main thread. |
| High, in spikes | Moderate | Long synchronous tasks (big `JSON.parse`, sync I/O) or GC pauses. |
| High, in regular spikes | Low to moderate, CPU below its limit | Check CPU throttling. |

That last row is the one most teams miss.

## CPU throttling: the slowdown your CPU graph hides

On Kubernetes, a CPU **limit** is enforced by the Linux CFS bandwidth controller. It works in periods, 100ms by default. A limit of `500m` means the container gets 50ms of CPU time per 100ms period. Once it uses that up, **every thread in the container is paused until the next period starts**.

Two things make this nasty for Node:

1. **Usage is averaged, throttling isn't.** Your dashboard says the pod averages 300m against a 500m limit. Looks fine. But CPU usage is bursty. A request arrives, the process burns 50ms of CPU in 30ms of wall time, and then it's frozen for the remaining 70ms of the period. The average never shows it.
2. **Node isn't really one thread.** V8 runs garbage collection on helper threads, and the libuv pool can run four tasks in parallel. All of those draw from the same quota. A GC cycle plus a couple of `zlib` calls can drain a small quota in a few milliseconds of wall time.

From the event loop's point of view, a throttle looks exactly like a long synchronous task: the timer fires late. That's why lag is such a good detector. You'll typically see lag spikes that cluster at tens of milliseconds, roughly up to the length of the CFS period, at moments when CPU usage looks comfortably below the limit.

### Confirming it

Don't stop at the lag pattern. Check the kernel's own counters. Inside the container on cgroup v2:

```bash
cat /sys/fs/cgroup/cpu.stat
# usage_usec      ...
# nr_periods      120345
# nr_throttled    18211
# throttled_usec  912004113
```

If `nr_throttled / nr_periods` is more than a few percent, you're being throttled regularly. In Prometheus with cAdvisor metrics, the same ratio is:

```promql
sum by (pod) (rate(container_cpu_cfs_throttled_periods_total{container="api"}[5m]))
/
sum by (pod) (rate(container_cpu_cfs_periods_total{container="api"}[5m]))
```

Put that graph next to `eventloop_lag_p99` and the correlation is usually obvious.

### Fixing it

- **Raise the limit or remove it.** Many teams keep CPU *requests* (for scheduling) and drop CPU *limits* for latency-sensitive services. Whether that's right for you depends on how much you trust your neighbours on the node, but it's worth testing.
- **Don't size limits from average usage.** Size them from peak usage over short windows.
- **Reduce parallel CPU bursts.** Bigger heaps can mean fewer GC cycles. Moving heavy compression or hashing out of the hot path helps too.
- **Scale out rather than up only if the work is truly CPU-bound.** If ELU is low and you're still throttled, more pods with the same small limit just spreads the problem around.

## When it's not throttling

If lag is high and ELU is high, you have actual CPU work on the main thread. Find it:

- `node --cpu-prof app.js` writes a `.cpuprofile` you can open in Chrome DevTools.
- In production, take a short profile through the inspector, or use a continuous profiler if you have one.
- Look for wide frames in `JSON.parse`, regex execution, template rendering, or your own loops.

If lag spikes line up with garbage collection, confirm it with `--trace-gc` or a `PerformanceObserver` on `'gc'` entries. Heavy allocation rates are usually the root cause, and heap profiles will show you where they come from.

<!-- TODO(Manas): optional, add a short real incident here, e.g. a service where lag p99 exposed CFS throttling that the CPU graph didn't show, and what changing the limit did. -->

## Using lag to protect the service

Once you trust the metric, you can act on it in real time:

- **Load shedding.** When lag p99 crosses a threshold, return `503` to new requests instead of accepting work you can't serve on time. For Fastify, [`@fastify/under-pressure`](https://github.com/fastify/under-pressure) does exactly this with a `maxEventLoopDelay` setting.
- **Readiness, not liveness.** Failing a readiness probe on high lag takes the pod out of rotation while it recovers. Failing a liveness probe restarts it, which throws away a warm process and pushes its traffic onto the others, often making things worse.
- **Alerting.** Alert on sustained lag p99, not single spikes.

I go deeper into rejecting work early in [backpressure and load shedding](/posts/backpressure-load-shedding-services/).

## Takeaways

- Event loop lag measures how long ready work waits. It slows every request in the process.
- Use `monitorEventLoopDelay`, track p99 and max, and read it next to event loop utilization.
- Regular lag spikes with low utilization and CPU below the limit usually mean CFS throttling. Confirm with `cpu.stat` or cAdvisor's throttled-periods ratio.
- High lag with high utilization is your own code. Profile it.
- Use lag for load shedding and readiness, not for liveness restarts.
