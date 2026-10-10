---
title: "Kafka Internals: Logs, Segments, Replication, and the ISR Explained"
date: 2026-09-16
category: "Distributed Systems"
tag: "Kafka Internals"
tags: ["Kafka", "Distributed Systems", "Replication", "Event Streaming"]
image: "img/blog/kafka-internals-log-replication-isr.jpg"
featured: false
description: "How Kafka actually stores and replicates data: partitions as append-only logs, segments and indexes, the page cache, leaders and the ISR, the high watermark, idempotent producers, transactions, and KRaft."
---

Kafka is easy to use and hard to operate well, and the gap between the two is almost entirely about internals. Once you know how a partition is stored on disk and how replicas agree on what's committed, most of Kafka's config options stop looking like magic and start looking like obvious trade-offs.

This post walks from the bottom up: one partition on one disk, then replication, then producers and consumers. For the operational side, see the companion post on [running Kafka at scale](/posts/kafka-at-scale-partitions-consumers-rebalancing/).

## A partition is just a log

A topic is a name. The real unit is the **partition**: an ordered, append-only sequence of records. Each record gets an **offset**, a number that only goes up. Kafka never updates a record in place. It only appends.

That one design choice explains a lot:

- **Writes are sequential.** Appending to the end of a file is the fastest thing a disk can do, spinning or SSD.
- **Reads are sequential too.** A consumer is just a cursor (an offset) moving forward through the log.
- **Ordering is per partition, not per topic.** Two records in different partitions have no defined order relative to each other.

## Segments and indexes

A partition isn't one giant file. On disk it's a directory of **segments**:

```text
orders-3/
  00000000000000000000.log
  00000000000000000000.index
  00000000000000000000.timeindex
  00000000000004718593.log
  00000000000004718593.index
  00000000000004718593.timeindex
```

Each segment file is named after the first offset it contains. Only the newest one, the **active segment**, receives writes. When it hits `segment.bytes` (1 GB by default) or `segment.ms`, Kafka rolls a new one.

Segments make retention cheap. Deleting old data means deleting whole files, not rewriting anything. With `retention.ms` set to 7 days, Kafka just removes segments whose newest record is older than that.

The `.index` file is a **sparse** map from offset to byte position. To serve "read from offset 4,800,000," Kafka finds the right segment by filename, binary-searches the index for the nearest earlier entry, and scans forward a short distance. The `.timeindex` does the same for timestamps, which is how consumers can seek to "everything since 9am."

## Why Kafka leans on the page cache

Kafka doesn't keep its own big in-memory cache. It writes to the OS page cache and lets the kernel decide when to flush to disk. Two consequences:

- **Recent data is served from memory.** Consumers that keep up read from the page cache and never touch the disk. Consumers that fall far behind force disk reads, which can slow everyone else on that broker. That's why one lagging consumer can affect latency for others.
- **Zero-copy transfers.** For plaintext connections, Kafka can use `sendfile` to move bytes from the page cache straight to the socket without copying through the JVM. TLS breaks this, because the data has to be encrypted in user space, which is one reason TLS costs real CPU on brokers.

By default Kafka doesn't `fsync` on every write. Durability comes from **replication**, not from forcing each write to disk. That's a deliberate choice, and it's why replication settings matter so much.

## Leaders, followers, and the ISR

Each partition has a **replication factor**, typically 3. One replica is the **leader** and handles all writes (and by default all reads). The others are **followers** that fetch from the leader, the same way a consumer would.

The **in-sync replica set (ISR)** is the leader plus every follower that's caught up. A follower falls out of the ISR if it hasn't caught up within `replica.lag.time.max.ms` (30 seconds by default). When it catches up again, it rejoins.

The ISR is what makes Kafka's durability guarantee precise. With these settings:

```properties
# producer
acks=all

# topic / broker
replication.factor=3
min.insync.replicas=2
unclean.leader.election.enable=false
```

a write is acknowledged only once every replica currently in the ISR has it, and Kafka refuses writes if the ISR shrinks below 2. So every acknowledged record is on at least two brokers. Lose one broker, and no acknowledged data is lost. Lose two, and the partition goes unavailable for writes instead of silently accepting data it can't protect.

That's the core trade-off in one line: **`min.insync.replicas` chooses between availability and durability when brokers fail.**

`unclean.leader.election.enable=false` (the default) completes the picture. It stops an out-of-sync replica from becoming leader, which would throw away records the old leader had acknowledged.

## The high watermark

Followers fetch asynchronously, so at any moment the leader has some records that not all ISR members have yet. The **high watermark** is the offset up to which every ISR member has the data. Consumers can only read up to the high watermark.

This is why a record you just produced isn't instantly visible to consumers. It becomes visible once it's replicated. It also means a consumer can never read a record that might later disappear during a leader failover.

When a leader fails and a new one is elected, followers may have extra records beyond what the new leader has. Kafka uses **leader epochs** (a counter bumped on every leader change) to work out exactly where each follower's log diverges, and truncates it to match. Older versions used the high watermark for this, which had edge cases that could lose or diverge data. Leader epochs fixed them.

## Idempotent producers

Network timeouts create a classic problem: the producer sends a batch, the broker writes it, the ack gets lost, and the producer retries. Without protection, that's a duplicate.

The **idempotent producer** (enabled by default since Kafka 3.0) fixes this. Each producer gets a **producer ID**, and each batch carries a **sequence number** per partition. The broker remembers the last sequence numbers it accepted per producer and partition, and silently drops duplicates. Retries become safe within a partition.

## Transactions

Idempotence covers one partition. **Transactions** let a producer write to several partitions (and commit consumer offsets) atomically. That's the building block behind Kafka's "exactly-once" processing for read-process-write pipelines.

Under the hood:

- The producer registers a `transactional.id` with a **transaction coordinator**, a broker that stores transaction state in the internal `__transaction_state` topic.
- Records are written to their partitions as normal, but marked as part of an open transaction.
- On commit, the coordinator writes **commit markers** into every partition involved.
- Consumers with `isolation.level=read_committed` only see records from committed transactions. They read up to the **last stable offset**, the point before the earliest still-open transaction.

Two important caveats. First, exactly-once applies within Kafka. The moment your consumer writes to an external database or calls an API, you're back to needing idempotent side effects. Second, a long-running open transaction holds back the last stable offset for every `read_committed` consumer on that partition.

## Consumer groups and offsets

Consumers in a **group** split a topic's partitions among themselves. Each partition is read by exactly one consumer in the group at a time, which is how Kafka preserves per-partition ordering while still scaling reads.

Progress is stored as committed offsets in the internal `__consumer_offsets` topic, which is itself a compacted Kafka topic. A **group coordinator** broker manages membership and assignment. How assignment and rebalancing behave is a big topic on its own, and I cover it in the [Kafka at scale](/posts/kafka-at-scale-partitions-consumers-rebalancing/) post.

## Compacted topics

Besides time-based deletion, a topic can use `cleanup.policy=compact`. Compaction keeps at least the **latest record for each key** and removes older ones. A record with a `null` value (a **tombstone**) marks a key for deletion.

That turns a topic into a durable, replayable key-value changelog. It's what `__consumer_offsets` uses, and it's the natural fit for things like "the current state of every customer" that a new service can rebuild by reading the topic from the beginning.

## KRaft: no more ZooKeeper

Kafka used to depend on ZooKeeper for cluster metadata: which brokers exist, which partitions they lead, topic configs. **KRaft** replaced that with a Raft-based quorum of controller nodes that store metadata in an internal log, `__cluster_metadata`. Kafka 4.0 removed ZooKeeper support entirely.

The practical wins are faster controller failover, much better scaling to large partition counts, and one less distributed system to run.

## Takeaways

- A partition is an append-only log split into segments. Retention deletes whole segments.
- Kafka relies on the page cache and replication for speed and durability, not per-write `fsync`.
- `acks=all` plus `min.insync.replicas=2` with replication factor 3 is the standard durable setup.
- Consumers only read up to the high watermark, so they never see data that could vanish on failover.
- Idempotent producers stop retry duplicates. Transactions extend that across partitions, but only within Kafka.
