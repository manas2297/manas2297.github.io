---
title: "Kafka at Scale: Partitions, Consumer Lag, Rebalancing, and Running It in Production"
date: 2026-09-23
category: "Distributed Systems"
tag: "Kafka at Scale"
tags: ["Kafka", "Event Streaming", "Scalability", "Consumer Groups", "Operations"]
image: "img/blog/kafka-at-scale-partitions-consumers-rebalancing.jpg"
featured: false
description: "Practical lessons for running Kafka at high throughput: sizing partitions, handling hot keys, measuring consumer lag, avoiding rebalance storms with cooperative and static membership, producer tuning, and keeping brokers balanced."
---

Kafka will take almost anything you throw at it on day one. The trouble starts later: a topic that can't keep up because it has too few partitions, consumers that stop for 30 seconds every time a pod restarts, one broker running hot while the others idle. None of this is exotic. It's what happens when the defaults meet real traffic.

This post covers the decisions that matter most once Kafka is load-bearing. If you want the "why" behind the storage and replication model, read [Kafka internals](/posts/kafka-internals-log-replication-isr/) first.

## Partitions are your unit of parallelism

A partition is consumed by exactly one consumer in a group at a time. So the partition count is the ceiling on how many consumers can work in parallel. Twenty partitions means at most twenty active consumers, no matter how many pods you deploy.

A reasonable way to size it:

1. Measure what one consumer can process per second for your real workload, including the database writes or API calls it makes. Call it *C*.
2. Take your target peak throughput *T*, with headroom for growth and for catching up after an outage.
3. You need at least *T / C* partitions. Round up generously.

Two rules make this decision sticky:

- **You can add partitions but never remove them.**
- **Adding partitions changes which partition a key maps to.** With the default partitioner, `hash(key) % partitions` shifts, so new records for a key can land on a different partition than old ones. If you depend on per-key ordering, adding partitions to a live topic needs a plan.

So it's usually better to start with more partitions than you need today. But don't go wild. Every partition costs memory, file handles, and replication traffic on the brokers, and very high partition counts make leader elections and rebalances slower.

## Hot partitions and key skew

Parallelism only helps if load spreads evenly. If one tenant generates 40% of your traffic and you key by tenant ID, one partition gets 40% of the load, and one consumer has to process it alone.

Ways out, from least to most invasive:

- **Pick a finer key.** Key by order ID or user ID instead of tenant ID, if you only need ordering at that level.
- **Salt hot keys.** Append a small suffix (`tenant-7#0` to `tenant-7#3`) for known heavy keys. You trade strict per-tenant ordering for spread, so only do this where ordering within the key doesn't matter.
- **Split the heavy traffic out.** Sometimes the honest answer is a dedicated topic for the noisy workload.

Ask the ordering question explicitly: what's the *smallest* scope where order actually matters? It's usually smaller than people assume.

## Consumer lag is the metric that matters

Consumer lag is the gap between the latest offset in a partition and the group's committed offset. It's the single best signal of whether your consumers are keeping up.

```bash
kafka-consumer-groups.sh --bootstrap-server broker:9092 \
  --describe --group order-processor
```

A few things I've learned about using it well:

- **Lag in messages is misleading across topics.** 10,000 messages of lag on a topic doing 50,000/sec is 200ms. On a topic doing 10/sec it's 17 minutes. Convert to **time lag** (how old the oldest unprocessed message is) for alerts.
- **Watch the trend, not the value.** Steady lag that isn't growing is fine. Lag that grows every minute means you're under-provisioned.
- **Look per partition.** Total lag can look fine while one partition, the hot one or the one with a stuck consumer, falls hours behind.

## Rebalancing: the hidden source of pauses

When a consumer joins or leaves a group, partitions get reassigned. That's a **rebalance**. With the old **eager** protocol, every consumer gives up *all* its partitions, waits for the new assignment, and starts again. Everyone stops, even consumers whose partitions don't change.

On Kubernetes, where rolling deploys restart pods one at a time, this can mean a stop-the-world pause per pod. A 20-pod rollout becomes 20 rebalances.

The fixes, roughly in order of impact:

### Cooperative rebalancing

With the `CooperativeStickyAssignor`, consumers only give up the partitions that actually move. Everyone else keeps working. If you're on the classic protocol, this is the single most valuable consumer setting:

```properties
partition.assignment.strategy=org.apache.kafka.clients.consumer.CooperativeStickyAssignor
```

### Static membership

Give each consumer instance a stable `group.instance.id` (a pod name from a StatefulSet works well). When a static member restarts and rejoins within `session.timeout.ms`, it gets its old partitions back and **no rebalance happens at all**. Set the session timeout a bit longer than a typical restart.

### The new consumer protocol

Kafka 4.0 made the new consumer group protocol from KIP-848 generally available (`group.protocol=consumer`). Assignment moves to the broker, and rebalances become incremental by design, without the group-wide synchronization barrier. If your brokers and clients support it, it's worth adopting.

### Don't trigger rebalances by accident

`max.poll.interval.ms` (5 minutes by default) is the maximum time between `poll()` calls. If processing one batch takes longer, the consumer is considered dead and kicked out, causing a rebalance, after which it rejoins and often does it again. If you see repeated rebalances under load, lower `max.poll.records` or speed up processing before raising the interval.

## Producer settings for throughput

At scale, the producer's job is to send fewer, bigger requests:

- **`linger.ms`**: wait a few milliseconds so batches fill. Values in the 5 to 20ms range are common for throughput-oriented producers.
- **`batch.size`**: the default 16 KB is small for high-volume topics. 64 KB to 256 KB is a common range.
- **`compression.type`**: `zstd` or `lz4`. Compression works per batch, so it pairs well with linger. It also cuts network and disk usage on the brokers.
- **`acks=all`** with the idempotent producer: keep it. The throughput cost is smaller than most people expect once batching is tuned, and it's what makes your durability settings actually mean something.

On the Go side, I covered how to structure a fast producer pipeline in [building high-throughput Kafka pipelines in Go](/posts/go-kafka-event-streams/).

## Keeping brokers balanced

Over time, clusters drift. New topics land unevenly, some partitions get much busier than others, and leadership concentrates on a few brokers. Symptoms: one broker's CPU or disk is far higher than the rest.

- **Rack awareness.** Set `broker.rack` so replicas of a partition land in different availability zones. Losing a zone then can't take out every replica of a partition.
- **Follower fetching.** With `client.rack` set on consumers, they can read from a replica in their own zone instead of the leader. That can cut cross-zone network costs on cloud providers noticeably.
- **Rebalance partitions deliberately.** Use partition reassignment with a replication throttle so moving data doesn't saturate the network. Tools like Cruise Control automate this based on actual load.
- **Tiered storage.** Kafka 3.9 made tiered storage production-ready. Old segments move to object storage, so brokers keep only recent data locally. Long retention stops dictating disk size, and adding brokers means moving much less data.

## Monitor what predicts trouble

Beyond consumer lag, the broker metrics I'd put on a dashboard first:

- **Under-replicated partitions**: should be zero. Non-zero for more than a moment means a broker is struggling or down.
- **Under-min-ISR partitions**: these partitions reject `acks=all` writes right now.
- **Request latency (produce and fetch) at p99**, broken down by broker.
- **Network handler and request handler idle ratio**: when these trend toward zero, the broker is saturated.
- **Disk usage and growth rate**, per broker.

<!-- TODO(Manas): optional, link or summarize your own Kafka scale story here, e.g. the cross-region migration case study, with what changed in lag or rebalance time. -->

For a real-world example of moving Kafka traffic between regions, see the [Kafka cross-region migration case study](/works/kafka-cross-region-migration/).

## Takeaways

- Partition count caps consumer parallelism. Size it from measured per-consumer throughput, with headroom.
- Adding partitions remaps keys. Plan for it if you rely on ordering.
- Alert on consumer lag in time, per partition, and on its trend.
- Use cooperative rebalancing and static membership, or the new consumer protocol, to stop deploys from pausing everything.
- Tune producers for fewer, bigger, compressed batches, and keep `acks=all`.
- Watch under-replicated and under-min-ISR partitions. They're your early warning.
