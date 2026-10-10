---
title: "Kafka Internals: Logs, Segments, Replication, and the ISR Explained"
seoTitle: "Kafka Internals: Logs, Segments, Replication, and the ISR"
date: 2026-09-16
category: "Distributed Systems"
tag: "Kafka Internals"
tags: ["Kafka", "Distributed Systems", "Replication", "Event Streaming"]
image: "img/blog/kafka-internals-log-replication-isr.jpg"
featured: false
description: "Kafka internals explained: partitions as append-only logs, segments and indexes, leaders and the ISR, the high watermark, idempotent producers, and KRaft."
---

Kafka is easy to use and hard to operate well. Nearly all of the gap is internals. Once you know how a partition sits on disk and how replicas agree on what's committed, most of the config options stop looking like magic. They turn into fairly obvious trade-offs.

I'll go bottom up: one partition on one disk, then replication, then producers and consumers. The operational side lives in the companion post on [running Kafka at scale](/posts/kafka-at-scale-partitions-consumers-rebalancing/).

## A partition is just a log

A topic is just a name. The real unit is the partition: an ordered, append-only sequence of records. Each record gets an offset, a number that only goes up. Kafka never updates a record in place.

That one choice explains a lot. Writes are sequential, and appending to the end of a file is the fastest thing a disk can do, spinning or SSD. Reads are sequential too, since a consumer is just a cursor (an offset) moving forward. And ordering is per partition, not per topic. Two records in different partitions have no defined order relative to each other.

## Segments and indexes

A partition isn't one giant file. On disk it's a directory of segments:

```text
orders-3/
  00000000000000000000.log
  00000000000000000000.index
  00000000000000000000.timeindex
  00000000000004718593.log
  00000000000004718593.index
  00000000000004718593.timeindex
```

Each segment file is named after the first offset it contains. Only the newest one, the active segment, takes writes. When it hits `segment.bytes` (1 GB by default) or `segment.ms`, Kafka rolls a new one.

Segments make retention cheap: deleting old data means deleting whole files. With `retention.ms` set to 7 days, Kafka removes segments whose newest record is older than that.

The `.index` file is a *sparse* map from offset to byte position. To serve "read from offset 4,800,000," Kafka finds the right segment by filename, binary-searches the index for the nearest earlier entry, and scans forward a short distance. The `.timeindex` does the same for timestamps, which is how consumers can seek to "everything since 9am."

## Why Kafka leans on the page cache

Kafka doesn't keep its own big in-memory cache. It writes to the OS page cache and lets the kernel decide when to flush.

So recent data is served from memory. Consumers that keep up read from the page cache and never touch the disk. Consumers that fall far behind force disk reads, which can slow down everyone else on that broker. One lagging consumer really can hurt latency for the others.

It also enables zero-copy. On plaintext connections Kafka can use `sendfile` to move bytes from the page cache straight to the socket without copying through the JVM. TLS breaks this, because encryption happens in user space, which is one reason TLS costs real CPU on brokers.

By default Kafka doesn't `fsync` every write. Durability comes from replication, not from forcing each write to disk. That's deliberate, and it's why the replication settings matter so much.

## Leaders, followers, and the ISR

Each partition has a replication factor, typically 3. One replica is the leader and handles all writes (and by default all reads). The others are followers that fetch from the leader, much like a consumer would.

The in-sync replica set (ISR) is the leader plus every follower that's caught up. A follower falls out of the ISR if it hasn't caught up within `replica.lag.time.max.ms` (30 seconds by default). When it catches up again, it rejoins.

The ISR is what makes Kafka's durability guarantee precise. With these settings:

```properties
# producer
acks=all

# topic / broker
replication.factor=3
min.insync.replicas=2
unclean.leader.election.enable=false
```

a write is acknowledged only once every replica currently in the ISR has it, and Kafka refuses writes if the ISR shrinks below 2. Every acknowledged record is on at least two brokers. Lose one broker and no acknowledged data is lost. Lose two and the partition stops accepting writes, rather than quietly taking data it can't protect.

That's the core trade-off: `min.insync.replicas` decides between availability and durability when brokers fail.

`unclean.leader.election.enable=false` (the default) completes the picture. It stops an out-of-sync replica from becoming leader, which would throw away records the old leader had acknowledged.

## The high watermark

Followers fetch asynchronously, so at any moment the leader holds some records that not every ISR member has yet. The high watermark is the offset up to which every ISR member has the data, and consumers can only read up to it.

That's why a record you just produced isn't instantly visible to consumers. It shows up once it's replicated. The upside is that a consumer can never read a record that might vanish in a leader failover.

When a leader fails and a new one is elected, followers may have extra records the new leader doesn't. Kafka uses leader epochs (a counter bumped on every leader change) to work out exactly where each follower's log diverges, and truncates it to match. Older versions used the high watermark for this, which had edge cases that could lose or diverge data. Leader epochs fixed them.

## Idempotent producers

The classic problem: the producer sends a batch, the broker writes it, the ack gets lost, and the producer retries. Without protection, that's a duplicate.

The idempotent producer (enabled by default since Kafka 3.0) fixes this. Each producer gets a producer ID, and each batch carries a sequence number per partition. The broker remembers the last sequence numbers it accepted per producer and partition, and silently drops duplicates. Retries become safe within a partition.

## Transactions

Idempotence covers one partition. Transactions let a producer write to several partitions (and commit consumer offsets) atomically. That's what Kafka's "exactly-once" processing for read-process-write pipelines is built on.

Under the hood:

- The producer registers a `transactional.id` with a transaction coordinator, a broker that stores transaction state in the internal `__transaction_state` topic.
- Records are written to their partitions as normal, but marked as part of an open transaction.
- On commit, the coordinator writes commit markers into every partition involved.
- Consumers with `isolation.level=read_committed` only see records from committed transactions. They read up to the last stable offset, the point before the earliest still-open transaction.

Two caveats. Exactly-once applies within Kafka only. As soon as your consumer writes to an external database or calls an API, you need idempotent side effects again. And a long-running open transaction holds back the last stable offset for every `read_committed` consumer on that partition.

## Consumer groups and offsets

Consumers in a group split a topic's partitions among themselves. Each partition is read by exactly one consumer in the group at a time, which is how Kafka preserves per-partition ordering while still scaling reads.

Progress is stored as committed offsets in the internal `__consumer_offsets` topic, which is itself a compacted Kafka topic. A group coordinator broker manages membership and assignment. Assignment and rebalancing are a big topic on their own, covered in the [Kafka at scale](/posts/kafka-at-scale-partitions-consumers-rebalancing/) post.

## Compacted topics

Besides time-based deletion, a topic can use `cleanup.policy=compact`. Compaction keeps at least the latest record for each key and removes older ones. A record with a `null` value (a tombstone) marks a key for deletion.

The result is a durable, replayable key-value changelog. `__consumer_offsets` works this way, and it's a natural fit for something like "the current state of every customer" that a new service can rebuild by reading from the beginning.

## KRaft: no more ZooKeeper

Kafka used to depend on ZooKeeper for cluster metadata: which brokers exist, which partitions they lead, topic configs. KRaft replaced that with a Raft-based quorum of controller nodes that store metadata in an internal log, `__cluster_metadata`. Kafka 4.0 removed ZooKeeper support entirely.

In practice you get faster controller failover and much better scaling to large partition counts. You also lose a whole distributed system you had to run, which I'm not going to miss.

If you only remember one config block from all this, make it `acks=all`, replication factor 3, and `min.insync.replicas=2`. Most of the rest follows from knowing why those three go together.
