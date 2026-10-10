---
title: "The Transactional Outbox Pattern and Idempotent Consumers, Explained"
seoTitle: "Transactional Outbox Pattern and Idempotent Consumers"
date: 2026-10-01
category: "Distributed Systems"
tag: "Event-Driven Design"
tags: ["Outbox Pattern", "Kafka", "PostgreSQL", "Idempotency", "Microservices"]
image: "img/blog/transactional-outbox-idempotent-consumers.jpg"
featured: false
description: "Why writing to your database and publishing to Kafka together breaks, how the transactional outbox pattern fixes it, and how to build idempotent consumers."
---

This looks completely reasonable. It's quietly broken:

```go
func PlaceOrder(ctx context.Context, o Order) error {
	if err := db.InsertOrder(ctx, o); err != nil {
		return err
	}
	return producer.Publish(ctx, "orders.placed", o)
}
```

If the process crashes, the network blips, or Kafka is briefly unavailable between those two lines, the order exists but the event never goes out. The warehouse never ships it. The email never sends. Swap the calls around and you get the opposite: an event for an order that was never saved.

That's the dual-write problem. You want to update two systems atomically and no transaction spans both. Retries don't help, because you can't tell whether the first attempt partly succeeded.

## The outbox pattern

Stop writing to two systems in the request path. Write to *one*, your database, and let a separate process do the publishing.

In the same transaction that saves the business data, insert a row into an `outbox` table describing the event:

```sql
CREATE TABLE outbox (
  id           uuid PRIMARY KEY,
  aggregate_id text        NOT NULL,
  topic        text        NOT NULL,
  payload      jsonb       NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX outbox_unpublished_idx
  ON outbox (created_at) WHERE published_at IS NULL;
```

```go
func PlaceOrder(ctx context.Context, o Order) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := insertOrder(ctx, tx, o); err != nil {
		return err
	}
	if err := insertOutbox(ctx, tx, uuid.New(), o.ID, "orders.placed", o); err != nil {
		return err
	}
	return tx.Commit()
}
```

The order and its event now commit together or not at all. The database transaction gives you the atomicity you couldn't get across two systems.

## Getting events out of the outbox

Something has to move rows from the outbox to Kafka. Two common ways to do it.

### Polling publisher

A background worker reads unpublished rows, publishes them, and marks them done:

```sql
SELECT id, topic, aggregate_id, payload
FROM outbox
WHERE published_at IS NULL
ORDER BY created_at
LIMIT 500
FOR UPDATE SKIP LOCKED;
```

`SKIP LOCKED` lets several publisher instances run without picking up the same rows. After the batch is acknowledged by Kafka, set `published_at` (or delete the rows) and commit.

Polling is simple and works with any database. You pay a small delay (the poll interval) and some extra database load; the partial index above keeps that poll query cheap, and [`EXPLAIN ANALYZE`](/posts/postgres-explain-analyze-guide/) will confirm it's actually being used. Clean up published rows regularly or the table grows forever.

### Change data capture

Or skip polling and read the database's write-ahead log. Tools like [Debezium](https://debezium.io/) stream inserts on the outbox table straight into Kafka, and Debezium even ships an outbox event router for this exact pattern. Lower latency, no polling queries. In exchange you run and monitor another piece of infrastructure, and you have to be careful with Postgres replication slots: a slot nobody reads keeps WAL around until the disk fills.

I'd start with polling and move to CDC when latency or database load actually becomes a problem.

## The catch: at-least-once delivery

Either way, the publisher can crash after publishing a batch but before marking it published. On restart it publishes those events again. The outbox guarantees every event goes out *at least once*, not exactly once.

You can't cheaply engineer that away. It's just how distributed messaging works. Kafka consumers have the same property: if a consumer processes a message and crashes before committing the offset, it'll see that message again. So the other half of this pattern is making consumers safe to run twice.

## Idempotent consumers

An operation is idempotent if doing it twice has the same effect as doing it once. A few ways to get there:

### Natural idempotency

Some operations already are. "Set order status to shipped" can run ten times with the same result; "add 1 to the shipped count" can't. Where possible, design events and handlers around setting state rather than applying deltas.

### Deduplication table

For everything else, record which events you've processed, in the *same transaction* as the side effect:

```sql
CREATE TABLE processed_events (
  consumer   text NOT NULL,
  event_id   uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);
```

```go
func Handle(ctx context.Context, ev Event) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(ctx,
		`INSERT INTO processed_events (consumer, event_id) VALUES ($1, $2)
		 ON CONFLICT DO NOTHING`, "billing", ev.ID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil // already handled
	}

	if err := applyCharge(ctx, tx, ev); err != nil {
		return err
	}
	return tx.Commit()
}
```

The insert and the side effect commit together. Crash halfway and both roll back, so the retry starts clean. A duplicate event makes the insert a no-op and the handler exits.

The event ID has to come from the producer. That's why the outbox row has its own `id`: generate it once, when the event is created, and carry it through.

### Side effects outside your database

A call to an external API, like a payment provider, can't go inside your transaction. Pass an idempotency key derived from the event ID instead. Most payment APIs support this: the provider remembers the key and returns the original result for repeats. If a downstream doesn't, you need your own state machine (pending, sent, confirmed) to know whether a retry is safe.

## Ordering

If order matters:

- **Use the aggregate ID as the Kafka key.** All events for `order-42` go to the same partition and stay in order.
- **Publish in commit order per aggregate.** A single polling publisher reading in `created_at` order is the simplest way, with one catch: `now()` is the transaction's *start* time, so rows can commit out of `created_at` order. That's fine as long as writes to the same aggregate are serialized (for example, because they all update the aggregate's row first). With multiple publishers, make sure events for the same aggregate don't get split across them.

Even then, consumers should cope with an older event arriving after a newer one. Store a version number and ignore events with a lower version than what's already applied. Same idea as the fencing tokens in my post on [distributed locking](/posts/distributed-locking-patterns/).

## What about Kafka transactions?

Kafka's exactly-once semantics work well for pipelines that read from Kafka and write back to Kafka. They do nothing for the dual write between your database and Kafka, because your database can't join a Kafka transaction. You still need the outbox. How Kafka transactions work is covered in [Kafka internals](/posts/kafka-internals-log-replication-isr/).

## Takeaways

- Writing to a database and a broker in one request isn't atomic. Eventually something gets lost.
- Write the event to an outbox table in the same transaction as the business data.
- Publish by polling (simple) or CDC (lower latency, more infrastructure).
- Delivery is at least once, so consumers must be idempotent: by design, via a dedup table in the same transaction, or with idempotency keys.
- If order matters, key by aggregate ID and version your events.
