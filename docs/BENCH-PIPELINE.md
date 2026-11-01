# Full pipeline load test

This is a load test with every pipeline stage active: ingest, fanout, delivery,
retries, and the inbox. It is separate from the ingest-only benchmark in
`docs/BENCH-HTTP.md`.

Hardware: Intel i5-10300H, 4 cores and 8 threads, 15 GiB RAM, one SSD, Docker
Compose on the same machine.

## Topology

| Component | Setting |
|---|---|
| API | 2 Node workers, DB pool 15 per worker |
| Core worker | relay, orchestrator, scheduler, reconciler, campaign, retention |
| Delivery workers | 3 processes, delivery role only, DB pool 10 each |
| Kafka partitions | 24 per topic |
| Partitions consumed concurrently | 16 per consumer |
| Provider rate limit | 600 attempts/s per channel, leased in chunks |
| Postgres | `max_connections=200`, `shared_buffers=1GB`, `max_wal_size=4GB`, WAL compression off |

## Workload

- `booking.confirmed` events through `POST /v1/events`.
- Three transactional channels per event: email, in-app, push.
- 1,400 distinct recipients, cycled. The seed contains 1,400 customers and 600
  professionals, so the run never hits an unknown recipient.
- 40 connections, 10 second warmup.
- Frequency caps were raised for this test so the measurement reflects transport
  capacity rather than policy deferral. With the seeded caps, a share of the
  events is scheduled for the next local day instead of delivered.

## 50 events per second, 10 minutes

| Field | Value |
|---|---|
| Requests sent | 29,989 |
| Accepted (2xx) | 29,989 |
| Rejected (4xx) | 0 |
| Server errors (5xx) | 0 |
| Timeouts | 0 |
| Throughput | 50.0 events/s |
| HTTP mean | 96.8 ms |
| HTTP p50, p90, p95, p99 | 55.9 ms, 179.2 ms, 366.3 ms, 810.8 ms |
| HTTP max | 1889.2 ms |
| Notifications created | 30,495 |
| Notifications terminal | 30,495 |
| Notifications lost | 0 |
| End-to-end p50, p95, p99 | 3.90 s, 11.55 s, 13.90 s |
| Fanout p50, p95 | 2.51 s, 9.23 s |
| Channel deliveries | 71,052 (2.33 per notification) |
| Channel deliveries per second | 114.6 |
| Outbox publish p50, p95, p99 | 0.32 s, 0.83 s, 1.95 s |
| Outbox publish max | 3.29 s |
| Max outbox pending | 157 rows |
| Max notifications awaiting fanout | 502 |
| Retries scheduled | 0 |
| DLQ depth | 0 |
| Notifications still open after the load | 0 |

Every accepted request produced exactly one notification, and every notification
reached a terminal state. The queue was empty when the run ended, so the rate was
sustained, not borrowed from backlog.

The delivery count is larger than the notification count because one booking fans
out to email, in-app, and push. It is not a retry count. The average was 2.33
channels per notification, and the run recorded zero scheduled retries and zero
DLQ rows.

CPU during the run, as a percentage of one core:

| Container | Average | Peak |
|---|---|---|
| API (2 workers) | 27.1% | 84.0% |
| Core worker | 80.9% | 117.7% |
| Delivery worker 1 | 57.1% | 97.4% |
| Delivery worker 2 | 53.9% | 114.9% |
| Delivery worker 3 | 56.1% | 110.9% |
| Postgres | 158.2% | 278.6% |
| Kafka | 53.5% | 238.5% |
| Mailpit | 21.6% | 56.5% |
| Redis | 5.1% | 13.0% |

## Capacity curve

Three runs on the same build, each with a 10 second warmup:

| Target | Duration | Accepted | End-to-end p95 | End-of-run backlog | Drain time |
|---|---|---|---|---|---|
| 50/s | 600 s | 29,989 | 11.6 s | 0 | 0 s |
| 60/s | 120 s | 7,214 | 12.2 s | 543 notifications | 11 s |
| 70/s | 60 s | 4,217 | 21.8 s | 1,109 notifications | 25 s |

50 events/s is the sustained rate on this laptop. 60 events/s runs just ahead of
the drain rate and leaves a short queue. 70 events/s exceeds capacity: the backlog
grows during the run and takes about as long as the run to clear.

At 50 events/s the pipeline moves 4.3M events per day. Each event produced about
2.33 channel deliveries, so that is roughly 10M delivery attempts per day. This is a
laptop measurement, not a production claim.

## What limited it before

The first full-pipeline run in this repository did not sustain 50 events/s.

The causes, in the order they were found:

1. KafkaJS processes one partition at a time by default. The orchestrator and the
   delivery consumer were each limited to a single in-flight message, regardless
   of how many partitions they owned. The consumer now sets
   `partitionsConsumedConcurrently`.
2. Delivery ran inside the same process as the relay, scheduler, reconciler,
   campaign, and retention loops. One core hosted every role. Delivery now runs in
   its own service with three replicas.
3. The relay published one message per Kafka request while holding a database
   transaction open, including the `FOR UPDATE` claim. It now leases a batch,
   commits, then publishes one request per topic.
4. The scheduler reclaimed `pending` deliveries after 30 seconds even when the
   outbox row was already published. Under load that republished queued work,
   which added more work to the same partitions. Recovery now checks for a
   published outbox row and only recovers work that is actually missing.
5. The delivery path issued a suppression query, a provider fault query, a
   notification re-read, and a sibling-status read for every attempt. The
   suppression list and the fault flag are now cached for a few seconds, and the
   notification status is recomputed and conditionally updated in one SQL
   statement inside the finalize transaction.
6. The orchestrator fetched templates and wrote deliveries and outbox rows one at
   a time. Templates are cached with pub/sub invalidation, and deliveries and
   outbox rows are written with `createMany`.
7. A delivery whose row no longer existed threw from the consumer, which blocked
   its Kafka partition on the same offset forever. Missing deliveries are now
   acknowledged.

## Reading the numbers

- The event-loss comparison against a dual-write baseline is in
  `docs/BENCH-LOSS.md`. It is a separate experiment and does not reuse these rows.
- The end-to-end latency includes queue time. At 50 events/s the p50 is under
  4 seconds and the p95 is about 12 seconds. At 60 events/s the tail grows.
- Postgres is the largest consumer at about 1.6 cores. The next step for more
  headroom is batched delivery writes, not more worker processes: three delivery
  processes already leave CPU idle while waiting on the database.
- The outbox relay is not the bottleneck. Its p99 publish latency stayed under
  2 seconds for the whole run.
- The frequency cap change matters. With the seeded caps, email is limited to 5
  per user per day, so a long run defers a large share of email deliveries. That
  is the policy working, but it makes the transport measurement smaller and
  noisier, which is why caps are lifted for this test.

## Reproduce

```bash
make demo
pnpm bench:http --rate 50 --connections 40 --duration 600 --warmup 10 \
  --users 1400 --worker running --output /tmp/bench-pipeline.md
```

The harness writes the HTTP section to the output path. The pipeline percentiles
and the CPU table above were collected from Postgres and `docker stats` during the
same run. Raise `PROVIDER_RATE_LIMIT` if the provider quota is lower than the
target rate.
