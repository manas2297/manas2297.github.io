---
title: "The Transactional Outbox Pattern and Idempotent Consumers, Explained"
date: 2026-10-01
category: "Distributed Systems"
tag: "Event-Driven Design"
tags: ["Outbox Pattern", "Kafka", "PostgreSQL", "Idempotency", "Microservices"]
image: "img/blog/transactional-outbox-idempotent-consumers.jpg"
featured: false
description: "Why writing to your database and publishing to Kafka in the same request is a bug, how the transactional outbox pattern fixes it, and how to build idempotent consumers that make at-least-once delivery safe."
---

Here's a piece of code that looks completely reasonable and is quietly broken:

```go
func PlaceOrder(ctx context.Context, o Order) error {
	if err := db.InsertOrder(ctx, o); err != nil {
		return err
	}
	return producer.Publish(ctx, "orders.placed", o)
}
```

If the process crashes, the network blips, or Kafka is briefly unavailable between those two lines, the order exists in the database but the event never goes out. Downstream, the warehouse never ships it and the email never sends. Swap the order of the calls and you get the opposite problem: an event for an order that was never saved.

This is the **dual-write problem**. You're trying to update two systems atomically, and there's no transaction that spans both. Retries don't save you either, because you can't tell whether the first attempt partly succeeded.

## The outbox pattern

The fix is to stop writing to two systems in the request path. Write to **one**, your database, and let a separate process handle publishing.

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

Now the order and its event are committed together or not at all. The database transaction gives you the atomicity you couldn't get across two systems.

## Getting events out of the outbox

Something has to move rows from the outbox to Kafka. There are two common ways.

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

Polling is simple and works with any database. The costs are a small delay (your poll interval) and some extra load on the database. Clean up published rows regularly so the table doesn't grow forever.

### Change data capture

Instead of polling, read the database's write-ahead log. Tools like [Debezium](https://debezium.io/) stream inserts on the outbox table straight into Kafka, and Debezium even ships an outbox event router for exactly this pattern. You get lower latency and no polling queries. The trade-off is another piece of infrastructure to run and monitor, plus some care around replication slots in Postgres: a slot that nobody reads keeps WAL around until the disk fills.

My rule of thumb: start with polling. Move to CDC when latency or database load actually becomes a problem.

## The catch: at-least-once delivery

Either way, the publisher can crash after publishing a batch and before marking it published. On restart, it publishes those events again. The outbox pattern guarantees every event goes out **at least once**, not exactly once.

That's not a flaw you can engineer away cheaply. It's the normal state of distributed messaging. Kafka consumers have the same property: if a consumer processes a message and crashes before committing the offset, it'll see that message again. So the other half of this pattern is making consumers safe to run twice.

## Idempotent consumers

An operation is **idempotent** if doing it twice has the same effect as doing it once. There are a few ways to get there.

### Natural idempotency

Some operations already are. "Set order status to shipped" can run ten times with the same result. "Add 1 to the shipped count" can't. Where you can, design events and handlers around setting state rather than applying deltas.

### Deduplication table

For everything else, record which events you've processed, in the **same transaction** as the side effect:

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

The insert and the side effect commit together. If the handler crashes halfway, both roll back and the retry starts clean. If the event is a duplicate, the insert does nothing and the handler exits.

The event ID has to come from the producer, which is why the outbox row has its own `id`. Generate it once, when the event is created, and carry it through.

### Side effects outside your database

If the handler calls an external API, like a payment provider, you can't put that call in your transaction. Pass an **idempotency key** derived from the event ID instead. Most payment APIs support this: the provider remembers the key and returns the original result for repeat requests. If a downstream doesn't support it, you need your own state machine (pending, sent, confirmed) to know whether a retry is safe.

## Ordering

Two practical points if order matters:

- **Use the aggregate ID as the Kafka key.** All events for `order-42` go to the same partition and stay in order.
- **Publish in commit order per aggregate.** A single polling publisher reading in `created_at` order is the simplest way. With multiple publishers, make sure events for the same aggregate don't get split across them.

Even then, consumers should be able to handle an older event arriving after a newer one, for example by storing a version number and ignoring events with a lower version than what's already applied. It's the same idea as the fencing tokens in my post on [distributed locking](/posts/distributed-locking-patterns/).

## What about Kafka transactions?

Kafka's exactly-once semantics work well for pipelines that read from Kafka and write back to Kafka. They don't help with the dual write between your database and Kafka, because your database can't take part in a Kafka transaction. The outbox is still the answer there. I go into how Kafka transactions work in [Kafka internals](/posts/kafka-internals-log-replication-isr/).

## Takeaways

- Writing to a database and a broker in the same request isn't atomic. Something will eventually get lost.
- Write the event to an outbox table in the same transaction as the business data.
- Publish from the outbox by polling (simple) or CDC (lower latency, more infrastructure).
- Delivery is at least once. Make consumers idempotent with natural idempotency, a dedup table in the same transaction, or idempotency keys.
- Key by aggregate ID and version your events if order matters.
