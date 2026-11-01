# Full pipeline load test

This is a load test with the worker running, not an ingest-only test. The worker is one process hosting all roles. The API runs four Node workers, the database pool is 30, and the three transactional channels are active.

Hardware: Intel i5-10300H, 8 threads, 15 GiB RAM, one SSD, Docker Compose.

Load shape: booking events only, 40 connections, 10 second warmup. The same 500 seeded customers are reused, so frequency caps affect the longer run.

## 200 events per second

| Field | Value |
|---|---|
| Target | 200 events/s |
| Duration | 600 s |
| Accepted | 117,494 |
| Achieved accept rate | 195.8/s |
| HTTP p50, p95, p99 | 40.3 ms, 312.1 ms, 560.1 ms |
| Non-2xx | 0 |
| Outbox pending at end of load | 36,815 |
| Notifications delivered at end of load | 5,647 |
| Delivery attempts in the run | 18,255 |
| Delivery attempts per second | 30.4 |
| Notification p50, p95, p99 | 642.3 s, 832.8 s, 886.6 s |
| Outbox p50, p95, p99 | 86.6 s, 153.0 s, 153.9 s |
| API CPU average | 59.3% of one core |
| Worker CPU average | 86.2% of one core |
| Postgres CPU average | 167.2% of one core |
| Kafka CPU average | 45.6% of one core |
| Redis CPU average | 5.5% of one core |

The API accepted every request. The worker did not keep up. Five minutes after the load stopped, 106,288 notifications were still open and 12,524 had reached a terminal state. The outbox was drained, so the relay was not the bottleneck.

## 50 events per second

| Field | Value |
|---|---|
| Target | 50 events/s |
| Duration | 600 s |
| Accepted | 30,025 |
| Achieved accept rate | 50.0/s |
| HTTP p50, p95, p99 | 35.8 ms, 156.3 ms, 527.1 ms |
| Non-2xx | 0 |
| Notifications delivered at end of load | 10,152 |
| Notifications pending after 5 minutes | 2,284 |
| Notifications deferred by frequency caps | 9,962 |
| Delivery attempts in the run | 24,120 |
| Delivery attempts per second | 40.2 |
| Notification p50, p95, p99 | 376.9 s, 588.3 s, 617.7 s |
| Outbox p50, p95, p99 | 0.257 s, 0.508 s, 0.685 s |
| Worker CPU average | 96.2% of one core |

The worker was saturated on one CPU core. The run reused 500 customers, so frequency caps deferred 9,962 notifications and reduced the delivery work. That makes this run unsuitable as a clean capacity number.

## Conclusion

The ingest path can accept 700 to 750 events per second with the worker stopped. The full pipeline does not sustain 50 events per second on this laptop with one worker process.

The bottleneck is the worker, not the relay or the API. At 50 events/s the worker used 96.2% of one core and still had 2,284 notifications open five minutes after the load stopped. At 200 events/s the backlog reached 106,288 open notifications.

The outbox stayed healthy. At 200 events/s its p99 publish latency was 153.9 seconds because the table was backlogged, but it drained to zero after the load stopped. At 50 events/s its p99 publish latency was 0.685 seconds.

A real full-pipeline capacity number needs worker replicas or batched delivery writes, and a workload with enough distinct users to avoid frequency caps.
