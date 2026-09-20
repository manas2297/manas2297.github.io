---
title: "Zero-Downtime Cross-Region Kafka Migration"
date: 2026-08-01
category: "Platform Case Study"
tag: "Distributed Systems"
image: "img/kafka_migration.png"
role: "Platform Engineer"
scale: "15M+ Users"
impact: "250ms → < 10ms Latency"
description: "Migrated our core Kafka cluster from the US to India with zero downtime, cutting publish and consume latency from 250ms to under 10ms for live trading systems."
---

## The Context

Our entire backend infrastructure—the matching engine, trading microservices, order books, and WebSocket push gateways—was hosted in AWS Mumbai (`ap-south-1`). However, due to legacy setup, our core self-managed Kafka cluster was sitting all the way over in North Virginia (`us-east-1`).

Because of the physical distance between India and the US, every single network round-trip took at least 200ms to 250ms. 

In a cryptocurrency exchange running 24/7, Kafka handles everything in real time: order placements, cancellations, trade executions, ledger deductions, market tickers, and candlestick chart updates. Having a 200ms+ physical tax on every produce and consume call created severe friction across the stack:
* **Order Pipeline Drag**: When a user submitted an order, backend services had to write to `us-east-1`, wait for an ack, and let downstream consumers pick it up across the Pacific. This added noticeable delay before an order could even reach the matching engine.
* **Laggy Live Feeds**: WebSocket servers in India had to pull trade events and order book deltas from the US, meaning price tickers and candlestick charts lagged behind the actual state of the market.
* **Bloated AWS Invoices**: Pumping high-frequency trade data and market feeds continuously across regions generated massive inter-region AWS data transfer costs every single month.

The platform had outgrown this setup. We had to bring Kafka to the same region as our application servers without taking the exchange offline.

---

## The Challenges

Migrating a mission-critical Kafka cluster under live financial trading traffic is one of the trickiest things you can do in production. If you make a mistake, you lose trades or duplicate money.

* **Zero Maintenance Window**: Crypto markets never close. We couldn't ask our users to stop trading or schedule a 2-hour downtime window on a Sunday night. The migration had to happen entirely in-flight.
* **Strict Financial Consistency & No Duplicates**: We processed millions of events per second. Dropping an execution message meant lost money; duplicating an execution event meant deducting a user's wallet balance twice.
* **Offset Discrepancy with MirrorMaker 1**: Kafka MirrorMaker 1 replicates messages, but it does not replicate consumer group offsets. Furthermore, partition offsets do not match between clusters—offset 1,000,000 in `us-east-1` might be offset 840,000 in Mumbai because of log compaction or retention cleanups. We couldn't just tell consumer services to point to Mumbai without a strategy to prevent them from reprocessing weeks of historical data or skipping messages.
* **Consumer Group Rebalance Storms**: We had dozens of microservices with multiple instances running in consumer groups. Switching them over simultaneously could trigger rolling "stop-the-world" rebalance storms, blocking consumption on critical order topics right during peak trading.
* **Replication Throughput over High-Latency WAN**: Replicating a massive volume of real-time trading events over long-haul WAN links without falling behind is tough. A slight network hiccup or unoptimized buffer configuration could cause replication lag to balloon into minutes.

---

## Architecture & Migration Execution

We provisioned a new, self-managed multi-broker Kafka cluster in Mumbai (`ap-south-1`) with NVMe storage and compute-optimized instances. To bridge the gap, we deployed a cluster of dedicated EC2 instances running **Kafka MirrorMaker 1** configured to pull from `us-east-1` and write into `ap-south-1`.

### 1. Network & Pipeline Tuning
Out of the box, MirrorMaker 1 struggled with the throughput and latency of cross-continent replication. We had to tune both ends of the MM1 pipeline:
* **Consumer Fetching**: Increased `fetch.min.bytes` (to 1MB) and set `fetch.max.wait.ms` to 500ms so MM1 consumer threads pulled large, consolidated chunks of messages from the US instead of making thousands of chatty network calls.
* **Producer Batching & Sockets**: Increased `linger.ms` (to 100–150ms) and `batch.size` (to 256KB) on the producer side, and expanded TCP socket buffers (`socket.send.buffer.bytes` and `socket.receive.buffer.bytes`) to 8MB–16MB. This kept the cross-region network pipes full and prevented TCP window exhaustion.
* **Compression**: Enabled `snappy` compression on replicated topics, drastically reducing WAN egress bandwidth usage without burning excessive CPU.

### 2. Full Observability with Prometheus & Grafana
You cannot migrate what you cannot see. Before touching any production traffic, we wired up comprehensive metrics across the entire pipeline:
* **Synthetic Canary Probes**: Relying on consumer lag counts alone was deceptive—a lag of 200 messages could mean 10ms of lag during high volume, or 5 minutes of lag during a dead market. We built a lightweight canary script that published a timestamped ping to `us-east-1` every second, while a probe in Mumbai consumed it and computed the exact end-to-end replication delay in milliseconds.
* **Grafana Dashboards & Prometheus Alerts**: Created real-time dashboards monitoring:
  * Per-partition consumer lag on both the old cluster and the target cluster.
  * MirrorMaker JVM heap usage, garbage collection pauses, and EC2 network I/O throughput.
  * Broker request queue times and `UnderReplicatedPartitions` count (kept strictly at 0).
  * Consumer group rebalance state transitions (`Stable` vs. `PreparingRebalance`).

### 3. The Two-Phase Cutover

Rather than flipping everything at once, we executed a two-phase cutover to control our rollback boundaries:

```
Step 1: Replicate in real-time
[Publishers in India] ---> (write ~250ms) ---> [US Kafka (us-east-1)]
                                                        |
                                            (MirrorMaker 1 / WAN)
                                                        v
[Consumers in India]  <--- (read < 5ms)  <--- [Mumbai Kafka (ap-south-1)]

Step 2: Flip Publishers
[Publishers in India] ---> (write < 5ms) ---> [Mumbai Kafka (ap-south-1)]
                                                        |
[Consumers in India]  <--- (read < 5ms)  <-------------+
```

#### Phase 1: Migrate Consumers First (Readers)
* Downstream consumer services (WebSocket pushers, trade ledger processors, analytics, and charting aggregators) were shifted to read from the Mumbai cluster first.
* Because MirrorMaker kept replication lag under 100ms, consumers were effectively reading real-time data locally in Mumbai.
* If a consumer service had an offset or parsing issue, we could safely fail it back to the US cluster because the primary write source hadn't changed.
* Consumer read latency dropped from ~250ms to under 5ms overnight.

#### Phase 2: Migrate Publishers Second (Writers)
* Once downstream consumers had run stably against the Mumbai cluster for multiple trading cycles, we planned the publisher cutover.
* We updated upstream publishing services (order submission, trade event emitters, and matching engine outputs) to write directly to the Mumbai cluster.
* At this point, both producers and consumers were on the exact same local AWS network in Mumbai.
* We let the remaining messages in the US cluster drain, verified zero residual lag, and safely decommissioned the US cluster and MirrorMaker EC2 instances.

---

## The Results & Business Impact

The cutover finished cleanly with zero downtime, no dropped orders, and no duplicate trade executions:

* **End-to-End Latency Slashed (250ms+ → < 10ms)**: Both publishing and consuming became local within AWS `ap-south-1`, completely removing the intercontinental speed-of-light penalty.
* **Higher Matching Engine & Order Throughput**: The order submission and matching pipeline stopped hanging on distant network ACKs. Order confirmation times dropped dramatically, reducing price slippage for traders during volatile market surges.
* **Real-Time WebSockets & Charts**: Downstream aggregators began processing trade ticks instantly, keeping order book depth and candlestick charts perfectly synchronized with the exchange's matching engine.
* **Immediate Cloud Cost Savings**: Eliminating continuous, high-volume cross-region data egress between India and the US resulted in immediate, substantial savings on our monthly AWS network bills.
* **Clean Rollback-Free Execution**: The two-phase cutover strategy allowed us to de-risk the migration at every milestone, proving cluster stability on the read path before committing our write path.
