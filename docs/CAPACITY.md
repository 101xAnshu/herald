# Capacity and cost

The numbers here are estimates with stated assumptions. They are not benchmark results. The benchmark in `docs/BENCH.md` measures the local single-shard path; the design envelope is a projection from that path.

## Profiles

| Dimension | Demo profile | Design envelope |
|---|---|---|
| Events per day | 10,000,000 | 300,000,000 |
| Average ingest rate | 116/s | 3,472/s |
| Peak factor | 10x | 10x |
| Peak ingest rate | 1,160/s | 34,720/s |
| Postgres shards | 1 | 12 |
| Kafka partitions per topic | 6 | 48 |
| Kafka brokers | 1 | 6 |
| Redis | 1 node | 3 shards with replicas |
| API processes | 4 | 8 |
| Worker processes | 1 | 24 |
| Hot Postgres retention | 14 days | 14 days |
| Kafka retention | 24 hours events and deliveries | 72 hours |
| Inbox retention | 30 days | 30 days default, 180 maximum |

## Assumptions

- A notification has 2.6 deliveries on average. Email, in-app, and mock push are the common mix. SMS is rare.
- The average event payload is 1 KB.
- A delivery attempt response is 0.7 KB after JSON compression in Postgres.
- A campaign targets at most 30M users and runs over hours, not seconds.
- Peak traffic is 10x the daily average. This covers evening booking peaks and a campaign launch.
- Provider throughput is the real ceiling for delivery. Herald can enqueue faster than any provider accepts.
- The local benchmark runs one API container with four Node workers and one worker process on an 8-thread laptop.

## Throughput math

### Ingest

```
10,000,000 / 86,400 = 115.7 events/s average
115.7 * 10 = 1,157 events/s peak
```

```
300,000,000 / 86,400 = 3,472 events/s average
3,472 * 10 = 34,720 events/s peak
```

Each accepted event creates one notification row, one timeline row, one outbox row, and later one fanout plan plus delivery rows. At peak design rate:

```
34,720 events/s * 3.0 rows = 104,160 row inserts/s
```

That is well beyond one Postgres primary. The twelve-shard plan spreads it to about 8,680 inserts/s per shard, which a properly provisioned primary can sustain with batched indexes.

### Kafka

Each event produces one event message and 2.6 delivery messages.

```
34,720 * 3.6 = 125,000 messages/s peak
```

With 48 partitions per topic and eight priority topics, the busiest topic sees about one quarter of the event volume:

```
34,720 / 48 = 723 events/s per event-topic partition
```

Delivery topics see roughly the same order of magnitude per channel. A partition at a few thousand small messages per second is comfortable. The broker count is driven by replication and retention, not raw message rate.

### Delivery

```
300,000,000 * 2.6 / 86,400 = 9,028 provider calls/s average
9,028 * 10 = 90,280 provider calls/s peak before provider limits
```

No email or SMS vendor accepts 90k/s from one account. The token bucket and the provider contract are the real backpressure. When a bucket is empty, the consumer pauses and Kafka lag becomes the buffer. This is why there is no unbounded in-process queue.

## Postgres sizing

Per event, before compression:

| Row | Estimate |
|---|---|
| `notifications` | 1.2 KB |
| `notification_events` | 3 rows, 1.2 KB total |
| `fanout_plans` | 1.0 KB |
| `deliveries` | 2.6 rows, 1.3 KB |
| `delivery_attempts` | 2.6 rows, 1.8 KB |
| `outbox` | 1.2 KB |
| Inbox item | 0.8 KB for in-app |
| Indexes and overhead | 35 percent |

Total is about 10 KB per event including indexes.

### 10M/day

```
10,000,000 * 10 KB = 100 GB/day
14 days hot = 1.4 TB
```

One 2 TB SSD volume is enough for the demo profile with headroom.

### 300M/day

```
300,000,000 * 10 KB = 3 TB/day
14 days hot = 42 TB
42 TB / 12 shards = 3.5 TB per shard
```

Each shard needs a 4 TB volume or a partition-aware tablespace. Daily partitions and `DROP TABLE` are required at this size. Deleting rows one at a time will not keep up.

### Write IOPS

Peak insert rate per shard is about 8,700 rows/s. With indexes, plan for 30k to 50k IOPS per shard. gp3 volumes can be provisioned to that level, but the cost is not linear at small sizes.

### Connections

- API: 20 connections per shard, 240 total.
- Workers: 10 connections per shard, 120 total.
- Ops fanout: capped at 4 concurrent shard queries.
- PgBouncer is recommended above 400 direct connections.

## Kafka sizing

### 10M/day

```
Events: 116/s average, 1,160/s peak
Deliveries: 302/s average, 3,016/s peak
Retention: 24 hours
Storage: about 80 GB across topics
```

One broker with six partitions per topic is enough for the demo.

### 300M/day

```
Events: 3,472/s average, 34,720/s peak
Deliveries: 9,028/s average, 90,280/s peak
Messages per event: 3.6
Peak messages: 125,000/s
Retention: 72 hours
Payload: about 1 KB before compression
Raw storage: 125,000 * 1 KB * 259,200 = 32 TB before replication
Replication factor 3: about 97 TB logical
```

Six brokers with 8 TB volumes and tiered storage cover the retention window with headroom. Partition counts in the topic catalog (48 for priority topics) are a starting point. Raise them before the peak, not during it.

## Redis sizing

| Key family | Count at 300M/day | Notes |
|---|---|---|
| Rate limit windows | 20M | 1 minute windows, expires automatically |
| Dedupe keys | 300M active for 24h | Use a shorter dedupe window or a segmented keyspace at this scale |
| Token buckets | Thousands | One per provider and channel |
| Campaign progress | Thousands | 24 hour TTL |
| SSE pub/sub | No retained state | Fanout only |

At 300M/day the dedupe keyspace is the dominant memory cost. A 24 hour window at 100 bytes per key is 30 GB before overhead. Either shorten the window to the event type's dedupe window (many are one hour) or use a Redis cluster with 3 shards and replicas. Redis remains an accelerator; losing it falls back to the Postgres unique constraint.

## Compute sizing

### API

Ingest is a handful of indexed reads and one transaction. Budget 1,500 to 2,500 accepted events/s per 2 vCPU process with a local Postgres and warm caches.

```
34,720 peak / 2,000 per process = 18 API processes
```

Eight processes with four vCPU each, behind a load balancer, cover the peak with headroom for TLS termination and metrics.

### Worker

The worker spends most of its time waiting on providers. A delivery process can hold hundreds of in-flight calls, but the token bucket keeps it bounded.

```
90,280 provider calls/s peak / 500 calls per process = 181 processes
```

That number is dominated by provider latency, not CPU. In practice a provider contract limits concurrency long before that. The design starts with 24 worker processes and scales by priority and channel. Critical and high pools are over-provisioned relative to their share of volume.

## Cost model

This is an order-of-magnitude model for a public-cloud deployment in one region. It is not a quote and it excludes egress, support, and provider fees.

| Item | Assumption | Monthly estimate |
|---|---|---|
| Postgres | 12 shards on 6 multi-AZ instances, 4 TB each | $12,000 |
| Kafka | 6 brokers, tiered storage, 100 TB logical | $4,500 |
| Redis | 3 shards with replicas, 64 GB each | $1,800 |
| API compute | 8 x 4 vCPU | $1,200 |
| Worker compute | 24 x 4 vCPU | $3,600 |
| Object storage | Backups and Kafka tier | $800 |
| Load balancer, NAT, misc | | $500 |
| Total | | about $24,400 |

Provider fees are separate and usually dominate at 300M/day. The infrastructure estimate assumes committed-use discounts of 30 percent. On-demand pricing is materially higher.

At 300M events per month, the infrastructure cost is roughly $0.08 per 1,000 events. At 10M/day, the same architecture is over-provisioned; the demo profile is closer to $150 per month on a single large VM with local disks.

## Bottlenecks in order

1. **Provider throughput.** Email and SMS vendors rate-limit before Herald runs out of CPU.
2. **Postgres write IOPS on the hot notification tables.** Partitioning and index discipline matter more than CPU.
3. **Kafka partition count and consumer rebalances.** Rebalances stop the world for a consumer group. Keep deployments rolling and session timeouts sane.
4. **Campaign materialization.** A 30M-user audience is a long batch job. It must not run inside the request path.
5. **Outbox relay publish rate.** One relay can publish thousands per second. At 300M/day, run relay instances per shard and watch `herald_outbox_oldest_age_seconds`.
6. **Redis dedupe memory.** Shorten the window or shard the keyspace.

## Benchmark plan

`pnpm bench` drives `POST /v1/events` with unique idempotency keys and writes `docs/BENCH.md`. The default run is 50 events/s for 10 seconds, which verifies the business path without saturating a laptop.

The current code was measured on the demo laptop with four API workers, a database pool of 30 per worker, and tuned Postgres settings. Autocannon accepted 711 to 753 events/s at a 900/s target. The committed run was 711.4/s with p50 46.5 ms, p95 104.3 ms, and p99 178.3 ms. The 1,000/s target was not reached. See `docs/BENCH-HTTP.md` for the exact run.

`pnpm bench:http` uses autocannon for an HTTP-level saturation run and writes `docs/BENCH-HTTP.md`. It cycles through seeded users and mints a unique idempotency key per request. Use it for the API ceiling; use the other benchmark for outbox and idempotency evidence.

```bash
pnpm bench --rate 500 --duration 60 --concurrency 40
pnpm bench:http --rate 900 --connections 40 --duration 30
```

The local rate limiter caps one key and one IP at 1,000 ingest requests per second. `bench:http` defaults below that ceiling. Raise the limiter in a disposable stack before running a higher saturation test.

Record the host CPU, memory, Postgres settings, and whether the worker was running. An ingest benchmark with the worker stopped measures the API and outbox write path. A run with the worker running measures the whole pipeline and will be limited by delivery, not ingest.

What the benchmark does not measure:

- Provider latency at scale.
- Kafka broker CPU under replication.
- Multi-shard fanout.
- Campaign materialization.
- Postgres failover time.

Those are measured by the drill, the campaign run, and production observation, not by a single ingest benchmark.

## Limits of this model

- The 10 KB per event estimate is a planning number, not a measurement from production.
- Peak factor 10x is a guess. A real capacity plan uses historical peaks per source.
- The cost table ignores data transfer between availability zones and regions.
- The design assumes 12 shards are enough. If one shard saturates, add shards before adding CPU.
- Provider pricing is excluded because it varies by contract and channel mix.
