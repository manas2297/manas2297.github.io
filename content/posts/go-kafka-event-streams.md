---
title: "Building High-Throughput Kafka Event Pipelines in Go"
date: 2026-08-02
category: "Distributed Systems"
tag: "Go & Kafka"
tags: ["Go", "Kafka", "Concurrency", "Performance"]
image: "img/go_event_streams.jpg"
featured: false
aliases: ["/posts/hello-world/"]
description: "How to structure a Go Kafka pipeline that stays fast under load: key-sharded workers that keep ordering, bounded channels for backpressure, and letting the client do the batching."
---

Most Go Kafka services start the same way: a consumer loop, a channel, and a handful of goroutines reading from it. That works fine at a few hundred messages a second. Push it to tens of thousands and the cracks show up in predictable places: ordering breaks, memory climbs, and latency gets spiky for reasons that are hard to see from dashboards.

This post walks through the shape I reach for when a pipeline has to be fast *and* correct.

## The naive version and what goes wrong

Here's the pattern almost everyone writes first:

```go
jobs := make(chan Job)

for i := 0; i < 32; i++ {
	go func() {
		for job := range jobs {
			process(job)
		}
	}()
}

for msg := range consumer.Messages() {
	jobs <- toJob(msg)
}
```

Three problems hide in there.

1. **Ordering is gone.** Kafka guarantees order within a partition. The moment two messages for the same key land on different goroutines, that guarantee means nothing. If message 2 for `order-42` finishes before message 1, you've just written stale state.
2. **Offsets get committed for work that isn't done.** If the consumer auto-commits while workers are still busy, a crash loses messages. If you commit manually from the workers, you have to commit in order, and the pool above can't tell you which offsets are safe.
3. **There's no real backpressure.** An unbuffered channel blocks the reader, which is good, but people usually "fix" the blocking by making the channel huge. Now you have 100k decoded messages sitting in memory and a GC that can't keep up.

## Shard by key, not by goroutine

The fix for ordering is to make the routing deterministic. Hash the message key and send it to a fixed worker. Every message for the same key goes to the same goroutine, so per-key order is preserved while different keys still run in parallel.

```go
type Pipeline struct {
	shards []chan Job
}

func NewPipeline(n, depth int, handle func(Job)) *Pipeline {
	p := &Pipeline{shards: make([]chan Job, n)}
	for i := range p.shards {
		ch := make(chan Job, depth) // small, bounded buffer
		p.shards[i] = ch
		go func() {
			for job := range ch {
				handle(job)
			}
		}()
	}
	return p
}

func (p *Pipeline) Submit(job Job) {
	h := fnv.New32a()
	h.Write(job.Key)
	p.shards[h.Sum32()%uint32(len(p.shards))] <- job
}
```

A few details matter here:

- **Keep `depth` small.** Something like 64 to 256. The buffer is there to smooth over jitter, not to store a backlog. When a shard fills up, `Submit` blocks, the consumer stops fetching, and Kafka holds the backlog for you. Kafka is a much better place to keep a queue than your heap.
- **Pick the shard count on purpose.** More shards means more parallelism, but if one key is hot, it still lands on one shard. Shard count can't fix skew; only a better key can.
- **Hashing is cheap, but not free.** For very hot paths, allocate the hasher once per goroutine or use a simple inline FNV. It's rarely the bottleneck, but check your profile before guessing.

## Commit offsets only for finished work

With key sharding, messages from the same partition can still complete out of order across different shards. So you can't just commit "the latest offset I've seen." You need to track, per partition, the highest offset below which *everything* is done.

The simplest approach that holds up: each partition keeps a sorted set of in-flight offsets. When a job finishes, remove its offset. The committable offset is the lowest in-flight offset (or the last seen offset + 1 if nothing is in flight). Commit that periodically, not after every message.

If that sounds like too much machinery, there's a simpler option that's often good enough: process each partition's batch fully, then commit, then poll again. You give up some parallelism across a batch boundary, but you never commit anything that isn't done. Plenty of production pipelines run exactly this way.

## Let the producer batch for you

On the produce side, the most common mistake is treating `Produce` like a synchronous RPC: send one record, wait for the ack, send the next. That caps you at one round trip per message.

Modern Go clients batch internally. With [franz-go](https://github.com/twmb/franz-go), for example, you configure batching once and fire records asynchronously:

```go
client, err := kgo.NewClient(
	kgo.SeedBrokers("broker-1:9092", "broker-2:9092"),
	kgo.RequiredAcks(kgo.AllISRAcks()),
	kgo.ProducerLinger(5*time.Millisecond),
	kgo.ProducerBatchCompression(kgo.ZstdCompression()),
	kgo.MaxBufferedRecords(10_000),
)
if err != nil {
	return err
}

client.Produce(ctx, &kgo.Record{Topic: "orders", Key: key, Value: payload},
	func(r *kgo.Record, err error) {
		if err != nil {
			produceErrors.Inc()
			// decide: retry, dead-letter, or fail the request
		}
	})
```

What each knob is doing:

- **Linger** waits a few milliseconds so more records can join a batch. Bigger batches mean fewer requests and much better compression. A few milliseconds of added latency usually buys a lot of throughput.
- **Compression** happens per batch, so it gets better as batches get bigger. zstd and lz4 are both solid choices.
- **`MaxBufferedRecords`** is your backpressure valve. When the buffer is full, `Produce` blocks instead of letting memory grow without limit.
- **`acks=all`** plus the idempotent producer (on by default in franz-go) means retries won't create duplicates within a partition. If you care about not losing data, keep both on.

## Watch the hot path

Once the structure is right, the remaining wins usually come from boring places:

- **Logging inside the loop.** A `fmt.Printf` or an unsampled structured log per message can easily cost more than the actual work. Log at the batch level, or sample.
- **Decoding allocations.** JSON decoding into `map[string]any` allocates a lot. Decoding into concrete structs, or reusing buffers, cuts GC pressure noticeably.
- **Per-message context and timers.** Creating a `context.WithTimeout` for every message adds a timer and allocations. For tight loops, set deadlines per batch.

Don't guess which of these is your problem. Grab a CPU and heap profile under realistic load. I wrote a separate guide on [Go performance debugging with pprof and the execution tracer](/posts/go-performance-debugging-pprof/) that covers how.

<!-- TODO(Manas): optional, add a short real example here, e.g. the throughput or p99 change you saw after moving to key-sharded workers on one of your pipelines. -->

## Takeaways

- Route by key hash so per-key ordering survives concurrency.
- Keep channels small. Let Kafka hold the backlog, not your heap.
- Commit only offsets whose work is fully done.
- Let the producer batch and compress; don't wait on every ack.
- Profile before you tune. The bottleneck is rarely where you expect.

If you're running these pipelines at serious scale, the broker side matters just as much. [Kafka internals](/posts/kafka-internals-log-replication-isr/) and [running Kafka at scale](/posts/kafka-at-scale-partitions-consumers-rebalancing/) cover what happens on the other end of the wire.
