---
title: "Building High-Throughput Kafka Event Pipelines in Go"
date: 2026-08-02
category: "Distributed Systems"
tag: "Go & Kafka"
tags: ["Go", "Kafka", "Concurrency", "Performance"]
image: "img/go_event_streams.jpg"
featured: false
aliases: ["/posts/hello-world/"]
description: "How to build a Go Kafka pipeline that stays fast under load: key-sharded workers that keep ordering, bounded channels for backpressure, and client batching."
---

Most Go Kafka services start out as a consumer loop, a channel, and a handful of goroutines reading from it. Fine at a few hundred messages a second. At tens of thousands, ordering breaks, memory climbs, and latency gets spiky in ways dashboards don't explain.

Below is the shape I reach for when a pipeline has to be fast *and* correct.

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

There are three problems hiding in there.

1. **Ordering is gone.** Kafka guarantees order within a partition. Once two messages for the same key land on different goroutines, that guarantee is worthless. If message 2 for `order-42` finishes before message 1, you've just written stale state.
2. **Offsets get committed for work that isn't done.** If the consumer auto-commits while workers are still busy, a crash loses messages. If you commit manually from the workers, you have to commit in order, and the pool above can't tell you which offsets are safe.
3. **There's no real backpressure.** An unbuffered channel blocks the reader, which is good. Then someone "fixes" the blocking by making the channel huge, and now there are 100k decoded messages in memory and a GC that can't keep up.

## Shard by key, not by goroutine

Ordering is fixed by making routing deterministic. Hash the message key and send it to a fixed worker. Every message for a key goes to the same goroutine, so per-key order holds while different keys still run in parallel.

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

Some details that matter:

- **Keep `depth` small**, something like 64 to 256. The buffer smooths over jitter; it isn't there to store a backlog. When a shard fills up, `Submit` blocks, the consumer stops fetching, and Kafka holds the backlog for you. Kafka is a far better place for a queue than your heap.
- **Pick the shard count on purpose.** More shards means more parallelism, but a hot key still lands on one shard. Shard count can't fix skew. Only a better key can.
- Hashing is cheap but not free. On very hot paths, allocate the hasher once per goroutine or inline a simple FNV. It's rarely the bottleneck, so check the profile before you bother.

## Commit offsets only for finished work

With key sharding, messages from one partition can still finish out of order across shards. So committing "the latest offset I've seen" is wrong. You need to track, per partition, the highest offset below which *everything* is done.

The simplest version that holds up: each partition keeps a sorted set of in-flight offsets. When a job finishes, remove its offset. The committable offset is the lowest in-flight offset (or the last seen offset + 1 if nothing is in flight). Commit that periodically, not after every message.

Too much machinery? There's a simpler option that's often good enough. Process each partition's batch fully, commit, then poll again. You lose some parallelism at batch boundaries, but you never commit anything that isn't done, and plenty of production pipelines run exactly like this.

## Let the producer batch for you

On the produce side, the usual mistake is treating `Produce` like a synchronous RPC: send one record, wait for the ack, send the next. That caps you at one round trip per message.

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

What each knob does:

- Linger waits a few milliseconds so more records can join a batch. Bigger batches mean fewer requests and much better compression, and a few milliseconds of extra latency usually buys a lot of throughput.
- Compression happens per batch, so it improves as batches grow. zstd and lz4 are both good picks.
- `MaxBufferedRecords` is your backpressure valve. When the buffer is full, `Produce` blocks instead of letting memory grow without limit.
- `acks=all` plus the idempotent producer (on by default in franz-go) means retries won't create duplicates within a partition. If you care about not losing data, keep both on.

## Watch the hot path

Once the structure is right, the remaining wins tend to be boring.

Logging inside the loop is the big one. A `fmt.Printf` or an unsampled structured log per message can easily cost more than the actual work, so log per batch or sample. JSON decoding into `map[string]any` allocates a lot; concrete structs or reused buffers cut GC pressure noticeably. And a `context.WithTimeout` per message adds a timer and allocations each time. In tight loops, set deadlines per batch.

Don't guess which of these is yours. Take a CPU and heap profile under realistic load. I wrote a separate guide on [Go performance debugging with pprof and the execution tracer](/posts/go-performance-debugging-pprof/) that covers how.

<!-- TODO(Manas): optional, add a short real example here, e.g. the throughput or p99 change you saw after moving to key-sharded workers on one of your pipelines. -->

## Wrapping up

None of this is clever. Route by key, keep buffers small, commit only finished work, and let the client batch. Most of the pipeline bugs I've had to chase came from skipping one of those.

At serious scale the broker side matters just as much. [Kafka internals](/posts/kafka-internals-log-replication-isr/) and [running Kafka at scale](/posts/kafka-at-scale-partitions-consumers-rebalancing/) cover what happens on the other end of the wire.
