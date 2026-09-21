---
title: "Distributed Drip Rate-Limiter for Event Streams"
date: 2026-08-03
category: "Platform Architecture"
tag: "Distributed Systems"
image: "img/ratelimit_worker.png"
role: "Platform Engineer"
scale: "Multi-Tenant Event Pipelines"
impact: "Zero Dropped Events & Controlled Throttling"
description: "Built a distributed drip rate-limiting worker and reusable scheduler package to throttle GCP Pub/Sub streams into deterministic time windows using Cloud Tasks and overflow topics."
---

## The Context

In our event-driven setup on GCP, upstream microservices regularly produce bursts of events onto Pub/Sub topics. While Pub/Sub handles massive throughput without blinking, the downstream consumers processing those events often hit hard walls.

Our downstream services regularly integrate with external third parties—such as banking payout rails, KYC providers, SMS/email gateways, and partner APIs. Almost all of them enforce strict rate limits. If we blast them with an unthrottled burst of events, they hit us with HTTP 429s, freeze our API credentials, or fail outright.

At an API gateway layer, handling rate limits is straightforward: you return an HTTP 429 and tell the client to retry. But in an asynchronous event queue handling financial payouts, account verifications, and trade notifications, **we cannot drop messages or rely on external clients to retry**.

We needed a platform-level solution: a **"drip" rate-limiting engine** that could:
1. Allow any team to define granular rate limits (RPS, RPM, or RPD) tied to business entities (like merchant ID, user ID, or endpoint).
2. Consume messages from a source Pub/Sub topic and evaluate them in real time against sliding or fixed time buckets.
3. Pass in-limit messages through immediately with minimal latency.
4. Smoothly buffer and schedule excess events to drip into the next available time windows, without blocking the consumer or holding open Pub/Sub messages.

---

## The Engineering Challenges

Applying rate limits to asynchronous streaming queues sounds deceptively simple until you run it across multiple pods with live money moving through it.

### 1. Pub/Sub Ack Deadlines & Redelivery Disasters
Pub/Sub expects consumers to acknowledge messages within a configured `ackDeadline` (typically 10 to 60 seconds). If an event exceeds its rate limit and a worker pod simply "sleeps" or holds the message in memory until the window resets:
* The `ackDeadline` expires, causing Pub/Sub to assume the worker died and redeliver that exact message to another pod, multiplying traffic during an active rate-limit spike.
* Worker memory balloons as thousands of pending messages pile up in local RAM.

### 2. Multi-Pod Concurrency & Counter Skew
Our workers ran across dozens of Kubernetes pods to handle baseline throughput. When a traffic spike hit, multiple pods pulled messages for the same tenant at the exact same millisecond. 
A naive `INCR` without coordination leads to classic race conditions: multiple pods see an open window, all assign their messages to it, and end up over-subscribing future windows before the counter catches up.

### 3. Calculating the Next Available Window (Not Just Delay)
If a merchant has a limit of 100 requests per minute (RPM) and an upstream service drops 500 events at 12:00:01, you cannot simply delay all 400 overflow messages by 60 seconds. If you do, all 400 dump into 12:01:00 simultaneously, immediately blowing past that window's quota too.
The system had to calculate a deterministic schedule: 100 run now, 100 drip into minute $T+1$, 100 into $T+2$, 100 into $T+3$, and 100 into $T+4$.

### 4. Order-Independent Domain Semantics
Because rate-limiting inherently decouples execution timing (some events execute immediately while overflow events execute in future windows), strict message ordering cannot be preserved across throttled boundaries. For our target workloads (e.g., individual idempotently-keyed payouts, webhook events, and KYC verifications), events are completely order-independent and self-contained, making this architectural model an ideal fit.

---

## Architecture & How It Works

We decoupled the system into three main components: a reusable scheduler package, a horizontally scalable worker, and a delayed execution loop backed by Cloud Tasks and dedicated overflow topics.

```
[GCP Pub/Sub Source Topic] 
            │
            ▼
   [Drip Rate-Limit Worker Pods]
   (uses Rate-Limit Scheduler Package + Redis Locks / Lua Scripts)
            │
            ├──> [Within Quota] ───> Immediate Processing / Downstream Consumer
            │
            └──> [Over Quota]
                       │
                       ├── 1. Enrich payload: `isRatelimited: true` + target `overflowTopic`
                       ├── 2. Calculate next deterministic available window timestamp
                       ├── 3. Create scheduled task in Cloud Tasks (`scheduleTime: windowTimestamp`)
                       │            │
                       │            └── On Confirmed Cloud Tasks 200 OK:
                       │                ACK message on source Pub/Sub subscription
                       │
                       ▼ (Cloud Tasks holds until target window opens)
               [HTTP Dispatcher Endpoint]
                       │
                       ▼
               [GCP Pub/Sub Overflow Topic]
                       │
                       ▼
               [Dedicated Overflow Consumer Service]
```

### 1. The Rate-Limit Scheduler Package
Rather than locking this logic inside one specific worker, I built the core engine as a reusable library package that any platform team could import:
* **Dynamic Key Extraction**: Teams define custom rules to pull keys from the payload or Pub/Sub attributes (e.g., `tenant_{merchant_id}:payouts` or `user_{id}:kyc_submit`).
* **Multi-Window Support**: Native handling for Requests Per Second (`RPS`), Requests Per Minute (`RPM`), and Requests Per Day (`RPD`).
* **Automated Window Calculation**: Computes exact target epoch timestamps, reserves capacity, enriches payload headers, and dispatches directly to the Cloud Tasks API.

### 2. Atomic Window Checking via Redis Lua Scripting & Fine-Grained Locks
To ensure zero counter drift and prevent race conditions when dozens of pods process events concurrently:
* **Fine-Grained Scope**: Locks and operations are strictly scoped to the entity key (e.g., `lock:tenant_984`), meaning workers processing events for thousands of different merchants run concurrently with zero contention.
* **Atomic Evaluation (Redis Lua Scripts / Locks)**:
  1. The worker evaluates the current bucket's usage counter atomically.
  2. If the current bucket has room, it increments the count and admits the message immediately in a single round-trip.
  3. If the current bucket is saturated, the script/scheduler iterates forward across future window keys (`key:timestamp`) to find the earliest window with remaining capacity.
  4. It reserves a slot in that future window by incrementing that bucket's counter and returns the assigned execution timestamp.
  5. By executing this logic atomically (either via atomic Lua scripts or short-lived distributed key locks), we completely avoid multi-pod race conditions where future windows get over-committed.

### 3. Guardrails: Max Delay Horizon & Anti-Starvation TTL
In the event of an upstream runaway script flooding millions of events for a single entity, the scheduler could theoretically push messages weeks or months into the future.
* We established a strict **Maximum Delay Horizon** (e.g., max delay cap of 2 hours for payouts, 24 hours for batch reports).
* If an incoming event's calculated window exceeds the maximum delay horizon, the scheduler aborts future scheduling and routes the event directly to a **Dead Letter Queue (DLQ)** with alert triggers.
* This prevents infinite future starvation and alerts engineering to rogue upstream publishers before Cloud Tasks quotas are consumed.

### 4. Strict ACK Sequencing with Cloud Tasks
Holding overflow messages in worker memory while waiting for future windows would cause memory bloat and trigger Pub/Sub redeliveries.

Instead, the scheduler offloads the wait state to **Google Cloud Tasks**:
* The task is submitted with `scheduleTime` set to the exact epoch timestamp of the assigned window.
* **Strict Two-Phase ACK Guarantee**: The worker **only ACKs** the original message on the source Pub/Sub subscription **after** the Cloud Tasks API returns a verified HTTP `200 OK` confirming the task is safely persisted in the queue.
* If Cloud Tasks encounters a network timeout or transient error, the worker **NACKs** the Pub/Sub message (or lets it time out), allowing Pub/Sub to redeliver it safely. This guarantees zero message loss even during infrastructure blips.

The scheduled payload is enriched with metadata:
```json
{
  "isRatelimited": true,
  "rateLimitMeta": {
    "key": "merchant_8421:payout",
    "windowType": "RPM",
    "limit": 100,
    "scheduledFor": "2026-08-03T14:02:00Z",
    "overflowTopic": "payout-events-overflow"
  },
  "originalPayload": {
    "payoutId": "pay_902184",
    "amount": 2500.00,
    "currency": "INR"
  }
}
```

### 5. HTTP Dispatcher & Dedicated Overflow Topic
When the scheduled window arrives:
1. Cloud Tasks triggers an HTTP POST request to a lightweight internal dispatcher service.
2. The dispatcher receives the payload and publishes it directly onto the designated `overflowTopic` specified in `rateLimitMeta`.
3. A separate **Overflow Consumer** subscribes to that topic and processes the event. Because the worker already reserved capacity for it in this window, the event flows through cleanly without choking the downstream provider.

---

## Results & Operational Impact

* **Zero Dropped Events**: Upstream microservices can trigger massive spikes without worrying about third-party vendor limits. Every single event is guaranteed to process.
* **Flat Pub/Sub Subscription Lag**: By immediately dispatching overflow to Cloud Tasks and ACKing messages on the main topic, we completely eliminated expired `ackDeadline` redeliveries and consumer lag spikes.
* **Protection for Downstream Vendors**: Completely eradicated HTTP 429 throttles and account suspensions from partner banking rails and communication vendors.
* **Reusable Platform Primitive**: Other engineering teams adopted the scheduler package directly, standardizing rate-limiting across payouts, webhooks, and communication pipelines without reinventing custom queues.
* **Minimal Infrastructure Footprint**: Because worker instances remain completely stateless and offload all delay state to managed Cloud Tasks, worker memory usage stays flat even during multi-million event bursts.
