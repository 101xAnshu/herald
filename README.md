# Herald

Herald is a multi-channel notification platform built around one rule: an accepted event is never lost.

Producers send business events. Herald decides which users receive them, which channels are allowed, which template to use, and when to send. It delivers email and an in-app inbox, simulates push and SMS, retries transient failures, records every attempt, and exposes the full path through an API, a CLI, metrics, and a trace endpoint.

The local stack is real: Postgres, Redis, Kafka, Mailpit, an API, and a worker. No vendor accounts are required.

## Why the design looks like this

Notification systems fail in boring ways. The process dies after the producer commits but before the message is sent. A provider times out after accepting a request. A campaign saturates the same queue as a security alert. A retry storms a provider that is already down. A customer asks what happened to one message three weeks later.

Herald handles those cases explicitly:

- **Transactional outbox.** Ingest commits the notification, its timeline event, and an outbox row in one Postgres transaction. The relay publishes committed rows and marks them published. A crash between commit and publish is a replay, not a lost event.
- **Priority isolation.** Critical, high, normal, and low events use separate Kafka topics and consumer groups. A campaign cannot starve a security alert.
- **Durable fanout plans.** Every channel decision stores the policy hash and the snapshot that produced it. The trace explains the decision later.
- **Guarded state machines.** Notification, delivery, retry, and campaign transitions are pure functions in `packages/core`. Terminal states do not regress.
- **Retries that respect providers.** Full jitter, a 30 second base, a 30 minute cap, and per-channel attempt budgets. Permanent errors fail fast. Ambiguous timeouts become `unknown` and wait for reconciliation.
- **One pipeline for campaigns.** The runner calls the same ingest service as producers. Pause takes effect within one batch. Resume continues from the next pending recipient.
- **A narrow, honest failover drill.** Streaming replication, standby promotion, application restart, and outbox replay. Kafka and Redis stay single instances, and the docs say what the drill does not prove.

## Architecture

```
 producer
    |
    | POST /v1/events
    v
+---------+     one transaction      +----------+
| ingest  | ------------------------> | Postgres |
+---------+   notification           +----------+
    |         timeline                    ^
    |         outbox                      |
    v                                     | claim + publish
 202 Accepted                             |
                                          v
                                    +-----------+
                                    |   relay   |
                                    +-----------+
                                          |
              +---------------------------+---------------------------+
              |             Kafka priority topics                     |
              |  critical / high / normal / low events               |
              +---------------------------+---------------------------+
                                          |
                                    +-----------+
                                    |orchestr.  | policy, quiet hours,
                                    +-----------+ caps, templates
                                          |
                                          v
                                  fanout plan + deliveries
                                          |
                          +---------------+---------------+
                          | Kafka delivery topics         |
                          | critical/high/normal/low      |
                          +---------------+---------------+
                                          |
                                    +-----------+
                                    | delivery  | token bucket, provider
                                    +-----------+ attempt, retry, terminal
                                          |
                    +---------------------+---------------------+
                    |                     |                     |
                  SMTP               in-app + SSE          mock push/SMS
                    |                     |                     |
                  Mailpit            inbox_items          deterministic
                                                              outcomes
```

The API never renders a template, resolves a preference, or calls a provider. That is what keeps ingest fast during a delivery storm.

## Repository layout

```
apps/
  api/          Express 5 app, modules, middleware, SSE
  worker/       relay, orchestrator, delivery, scheduler, reconciler, campaign, retention
  cli/          herald command tree
packages/
  config/       Zod environment schema and derived config
  contracts/    event, API, and catalog contracts
  core/         policy, state machines, retries, rendering, ids, hashing
  db/           Prisma schema, migrations, shard router, repositories, use cases
  queue/        Kafka publisher, consumer, topic catalog
  cache/        Redis store, rate limits, token buckets, pub/sub
  providers/    SMTP, in-app, mock push, mock SMS
  observability/Pino logger, prom-client metrics, trace context
  sdk/          typed producer and consumer client
  testing/      fixtures and small assertions
infra/
  postgres/     init SQL and replication assets
docs/           architecture, capacity, runbooks, drills, ADRs, catalog
scripts/        smoke test, benchmark, failover drill
site/           static landing page
```

The workspace is managed by pnpm and Turborepo.

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node 22 |
| Language | TypeScript, strict |
| HTTP | Express 5 |
| Validation | Zod |
| CLI | Commander |
| Database | PostgreSQL 16 |
| ORM | Prisma 7 with `@prisma/adapter-pg` |
| Queue | Apache Kafka 3.9 in KRaft mode |
| Kafka client | KafkaJS |
| Cache | Redis 7 |
| Email | SMTP to Mailpit |
| Logs | Pino, JSON to stdout |
| Metrics | prom-client |
| Tests | Vitest |
| API docs | OpenAPI 3.1 generated from Zod, served with Scalar |

## Quickstart

Requirements: Docker 24+, Node 22+, pnpm, GNU make, and about 8 GB of free RAM.

```bash
git clone https://github.com/101xAnshu/herald.git
cd herald
pnpm install
make demo
pnpm herald init --demo
pnpm herald demo
```

`make demo` builds the API and worker images, starts Postgres, Redis, Kafka, Mailpit, the API, and the worker, applies migrations, seeds the small dataset, and writes `.herald/demo.env`.

Local URLs:

| Service | URL |
|---|---|
| API | http://localhost:3000 |
| API docs | http://localhost:3000/docs |
| Metrics | http://localhost:3000/metrics |
| Health | http://localhost:3000/health/ready |
| Mailpit | http://localhost:8025 |
| Postgres | localhost:5433 |
| Redis | localhost:6379 |
| Kafka | localhost:9092 |

Postgres uses port 5433 by default so it does not collide with another local Postgres. Change `DATABASE_URL` and the Compose port mapping together if needed.

## Sending events

Service keys are bound to one source. A booking key can only send `booking` event types.

```bash
export KEY=$(grep HERALD_BOOKING_API_KEY .herald/demo.env | cut -d= -f2)

curl -s -X POST http://localhost:3000/v1/events \
  -H "authorization: Bearer $KEY" \
  -H "content-type: application/json" \
  -d '{
    "type": "booking.confirmed",
    "schema_version": 1,
    "recipient": { "external_id": "cust_00001" },
    "idempotency_key": "booking:bkg_8821:confirmed",
    "data": {
      "booking_id": "bkg_8821",
      "service": "plumbing",
      "pro_name": "Ravi",
      "scheduled_for": "2026-11-02T10:00:00+05:30",
      "address_label": "Home"
    }
  }'
```

Response:

```json
{
  "data": {
    "notification_id": "0199f3f2-7d4a-7c3e-9b1a-2f6e5d4c3b2a",
    "status": "accepted",
    "trace_id": "0199f3f2-7d4a-7c3e-9b1a-2f6e5d4c3b2a"
  },
  "trace_id": "0199f3f2-7d4a-7c3e-9b1a-2f6e5d4c3b2a"
}
```

Idempotency is scoped to `(user_id, source, idempotency_key)`. The same key with the same payload returns the original notification ID. The same key with a different payload returns `409 idempotency_conflict`.

## CLI

```bash
pnpm herald init --demo
pnpm herald doctor
pnpm herald health --watch
pnpm herald stats
pnpm herald send booking.confirmed --user cust_00001 --data '{...}'
pnpm herald notifications list --source booking --limit 10
pnpm herald trace <notification-id>
pnpm herald tail --source booking
pnpm herald inbox list --user cust_00001 --unread
pnpm herald inbox watch --user cust_00001
pnpm herald campaign list
pnpm herald campaign watch <campaign-id>
pnpm herald dlq list
pnpm herald failover --dry-run
```

Read commands accept `--json`. Destructive commands require `--yes` or an interactive confirmation. `dlq replay` is a dry run unless `--apply` is passed.

## Layout of a request

Ingest, in order:

1. Authenticate the service key and resolve its source.
2. Apply per-key, per-source, and per-IP rate limits.
3. Reject a paused source for non-critical traffic.
4. Validate the event envelope and the event type payload schema.
5. Resolve `external_id` to a deterministic UUIDv5 user ID and route to that user's shard.
6. Check `(user_id, source, idempotency_key)` and compare payload hashes.
7. Check the outbox backlog threshold.
8. Commit `notifications`, `notification_events`, and `outbox` in one transaction.
9. Return `202`.

Orchestration, after the relay publishes:

1. Stop if the notification is terminal or already has a fanout plan.
2. Load the user, preferences, settings, devices, and suppression state.
3. Resolve policy: event type, source, preference, quiet hours, caps, suppression, provider availability.
4. Select templates with locale fallback: exact locale, language, then `en`.
5. Write the immutable fanout plan.
6. Create one delivery per allowed channel and one outbox row per delivery.
7. Commit the Kafka offset after the transaction.

Delivery:

1. Claim the delivery with a status guard.
2. Check the suppression list again immediately before the call.
3. Acquire a Redis token bucket token.
4. Render the selected template and record a permanent failure if variables are missing.
5. Call the adapter with a stable idempotency key derived from the delivery ID.
6. Record the attempt with latency, result, error class, and response metadata.
7. Move to accepted, delivered, retry scheduled, unknown, failed, or suppressed.
8. Recompute the notification state and update a campaign recipient if one exists.

## Data model

Core tables:

| Group | Tables |
|---|---|
| Access | `api_clients`, `audit_log` |
| Catalog | `event_types`, `templates`, `template_versions` |
| Users | `users`, `devices`, `preferences`, `user_settings`, `consent_events`, `suppression_list` |
| Notifications | `notifications`, `notification_events`, `fanout_plans`, `deliveries`, `delivery_attempts`, `retry_schedules`, `provider_events`, `inbox_items`, `outbox` |
| Campaigns | `campaigns`, `campaign_recipients` |
| Operations | `job_runs`, `source_controls`, `dead_letters`, `provider_faults` |

IDs are UUIDv7 except `users.id`, which is UUIDv5 derived from `external_id`. That makes shard routing possible without a global user directory.

Tables and columns use snake_case through Prisma `@@map` and `@map`. TypeScript uses camelCase. API and event JSON use snake_case.

## Observability

- Every request carries `X-Trace-Id`. A valid incoming UUID is reused; otherwise the API generates a UUIDv7.
- The trace ID is stored on the notification, copied into outbox headers, carried in Kafka message headers, logged by workers, and returned by `GET /v1/notifications/:id/trace`.
- `GET /metrics` exposes the prom-client registry on the API. The worker exposes the same registry on port 9100.
- Logs are Pino JSON with redaction for authorization headers, API keys, JWTs, email, phone, message bodies, and payloads.
- `herald health`, `herald stats`, and `herald trace` are the operator views. No Grafana, Loki, Tempo, or OTel Collector is required.

## Campaigns

The seeded `Pune winback` campaign targets 1,000 Pune customers who have an enabled marketing preference and have not booked in 30 days.

```bash
pnpm herald campaign list
pnpm herald campaign launch <campaign-id>
pnpm herald campaign watch <campaign-id>
pnpm herald campaign pause <campaign-id>
pnpm herald campaign resume <campaign-id>
```

The runner materializes recipients in batches, emits low-priority `campaign.message` events through the ingest service, and derives the funnel from recipient and delivery state. Pause is checked before every batch. Cancel marks remaining recipients canceled; in-flight deliveries may finish.

## Email

Email is sent over SMTP to Mailpit. Open http://localhost:8025 to inspect messages. The email adapter sets `X-Herald-Idempotency-Key`, `X-Herald-Delivery-Id`, and `X-Herald-Trace-Id` headers so an operator can connect an inbox message back to a trace.

## Failover drill

```bash
pnpm herald failover --dry-run
make drill-db
```

The drill starts a Postgres standby with `pg_basebackup`, waits for streaming replication to catch up, stops the writers, promotes the standby, starts the API and worker against the promoted node on port 3001, publishes a new event, and waits for the outbox to drain. The result is written to `drill-results/latest.md`.

It does not include MirrorMaker, a second Kafka, a second Redis, or a regional failover. See `docs/DRILLS.md`.

## Tests

```bash
pnpm test                 # unit tests
make test-integration     # disposable compose.test.yml stack plus smoke test
make test-e2e             # smoke test against the running stack
make bench                # business-path benchmark, writes docs/BENCH.md
make bench-http           # autocannon HTTP benchmark, writes docs/BENCH-HTTP.md
make verify               # build, lint, typecheck, unit tests, smoke test
```

## Scale

The demo profile is sized for a laptop: one Postgres shard, one Kafka broker, one Redis, one API container with four Node workers, and one worker process.

The design envelope is 10M events per day locally and 300M events per day with 12 Postgres shards and 48 Kafka partitions per priority topic. `docs/CAPACITY.md` gives the throughput math, storage estimates, and cost assumptions. The capacity numbers are estimates, not a benchmark claim.

## Measured local ingest

With `API_WORKERS=4`, `DB_POOL_MAX=30`, the tuned Postgres settings in `compose.yml`, and the worker stopped, autocannon recorded 711 to 753 events/s against a 900 events/s target on the demo laptop. The committed run delivered 711.4 events/s, p50 46.5 ms, p95 104.3 ms, p99 178.3 ms, with no failed request. The best run reached 753 events/s with p99 130.1 ms. The report is in `docs/BENCH-HTTP.md`.

A separate closed-loop Node client recorded 516 events/s with the same load settings, p50 10.6 ms, p95 77.2 ms, and p99 493.7 ms. Its lower p50 is service time, not queue time. Its p99 is worse because the client, not the API, saturates first. See `docs/BENCH.md`.

The 1,000 events/s target was not reached. At a 1,000 target the API accepted about 729 events/s with p99 180 ms in the best run, and the tail moved between 130 and 443 ms across repeated runs. The system is close to the CPU limit of this laptop, not to a configurable bottleneck. With four API workers, `/metrics` reports one worker's registry, not the sum; `/v1/ops/stats` reads the database and stays aggregate.

## Deliberate limits

- No Kubernetes, Terraform, or cloud account.
- No service mesh, API gateway, or schema registry server.
- No Prometheus server, Grafana, Loki, Tempo, or OTel Collector.
- No WebSocket, presence, or connection registry.
- No real push or SMS vendor. Those adapters are deterministic mocks.
- No exactly-once provider write. Provider idempotency plus reconciliation is the guarantee.
- No cross-shard global index. Ops reads fan out with capped concurrency.

## License

MIT. See `LICENSE`.
