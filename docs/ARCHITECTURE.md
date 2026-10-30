# Architecture

This document describes the system that is actually in the repository. It does not describe a future platform.

## Goals

1. Never acknowledge an event that is not durably recorded.
2. Keep transactional traffic isolated from campaign traffic.
3. Make every fanout and delivery decision explainable after the fact.
4. Survive provider failures with bounded retries and an explicit ambiguous state.
5. Run the whole path on one machine without vendor accounts.

## Components

| Component | Responsibility |
|---|---|
| API | Authentication, validation, ingest, read APIs, SSE, metrics |
| Worker: relay | Claims unpublished outbox rows and publishes them to Kafka |
| Worker: orchestrator | Resolves policy, writes the fanout plan, creates deliveries |
| Worker: delivery | Claims a delivery, calls a provider, records the attempt |
| Worker: scheduler | Promotes due retries, deferred notifications, scheduled campaigns |
| Worker: reconciler | Resolves `unknown` deliveries through a provider status lookup |
| Worker: campaign | Materializes audiences, emits campaign events, paces batches |
| Worker: retention | Deletes expired inbox rows and aged published rows |
| CLI | Setup, diagnostics, sending, inspection, campaigns, ops actions, drill |
| SDK | Typed producer and consumer client |
| Contracts | Zod schemas shared by API, worker, SDK, CLI, and tests |
| Core | Pure domain rules with no infrastructure imports |
| DB | Prisma schema, migrations, shard router, repositories, use cases |
| Queue | Kafka producer, consumer, topic catalog |
| Cache | Redis store, fixed-window limits, token buckets, pub/sub |
| Providers | SMTP, in-app, mock push, mock SMS |

The API and worker share Postgres tables and Kafka topics but never share process memory. The campaign runner imports `ingestEvent` from `@herald/db`; it does not call the HTTP API and does not have a separate write path.

## Dependency direction

```
config   contracts
   \        /
      core
       |
      db ------ observability
       |
   api / worker / cli
```

`packages/core` cannot import Express, Prisma, Kafka, Redis, or a provider SDK. It contains policy, state transitions, retry math, template rendering, id and hash helpers, and webhook signature verification. That keeps the domain testable without infrastructure.

## Ingest

`POST /v1/events`

1. The auth middleware parses the bearer token. Tokens starting with `hrld_` are service keys. Others are user JWTs.
2. A service key carries exactly one source and a scope list. The key source is authoritative.
3. The route requires `events:write` and runs per-key, per-source, and per-IP rate limits.
4. The body is validated against `IngestEventSchema`.
5. `external_id` is converted to a UUIDv5 user ID. The shard is `sha256(user_id) % SHARD_COUNT`.
6. The user is loaded from that shard.
7. The event type is loaded from the catalog by `(key, schema_version)`. The source must be allowed. The event data is validated against the stored JSON Schema.
8. Priority is the event type default unless the producer override is allowed.
9. A paused source rejects non-critical events with `409`. Critical events pass when `ALLOW_CRITICAL_WHEN_PAUSED` is true.
10. Idempotency is checked by `(user_id, source, idempotency_key)`. The request hash covers the type, schema version, recipient, data, and priority override.
11. The outbox backlog is checked against `OUTBOX_MAX_PENDING_ROWS` and `OUTBOX_MAX_AGE_SECONDS`.
12. One transaction inserts the notification, an `accepted` timeline event, and an outbox row.
13. The API returns `202` with `notification_id`, `status: accepted`, and `trace_id`.

The transaction is the boundary. There is no point after commit where the event exists only in process memory.

## Outbox relay

The relay claims rows with:

```sql
SELECT id
FROM outbox
WHERE status = 'pending' AND available_at <= now()
ORDER BY available_at, id
LIMIT $1
FOR UPDATE SKIP LOCKED
```

It publishes each row, then marks the claimed rows published in the same transaction. A publish failure increments `attempts`, stores `last_error`, and backs off. Ten failures mark the row `failed` for an operator.

A crash after publish but before commit republishes the message. The orchestrator's unique fanout plan and idempotent delivery constraints make that harmless.

## Orchestration

`orchestrateNotification` loads the notification and stops when it is terminal or already has a fanout plan.

It builds a user snapshot with preferences, quiet hours, marketing state, active devices, and suppression rows. Suppression addresses are compared through HMAC hashes, not plaintext.

Policy order:

1. Event type allowed channels.
2. Source policy, if any.
3. User status and hard suppression.
4. Contact availability and provider availability.
5. User preference for `(category, channel)`.
6. Marketing opt-in requirements.
7. Quiet hours in the user's timezone.
8. Frequency caps per channel for the current UTC day.

A critical event bypasses quiet hours, marketing pauses, and preference opt-outs. Hard suppression always wins.

The result is one of:

- `process`: at least one channel is allowed.
- `scheduled`: every remaining channel is deferred by quiet hours or a cap.
- `suppressed`: every channel was explicitly blocked by policy.
- `failed`: no channel is usable for an operational reason, such as a missing address or unavailable provider.

For `process`, template selection uses the event type policy key, or `data.template_key`, then locale fallback. The fanout plan stores the policy hash, the full policy snapshot, and the channel decisions. Deliveries are created with a provider name and a template version.

The Kafka offset is committed by the consumer only after this transaction returns.

## Delivery

`processDelivery` claims a delivery whose status is `pending` or `retry_scheduled`. The claim is a conditional update, so two workers cannot send the same delivery.

Before the provider call:

- The delivery is marked `sending`.
- Suppression is checked again for the address or device hash.
- The template is rendered. Missing variables and oversized output are permanent failures.
- A Redis token bucket is acquired for the channel.

The adapter receives a stable idempotency key, `herald:<delivery_id>`, and the trace ID. The attempt row records the attempt number, provider, request ID, result, error class, error code, latency, and response metadata.

Outcomes:

| Outcome | Delivery state | Next action |
|---|---|---|
| Provider accepted | `accepted` | Terminal success |
| Provider confirmed | `delivered` | Terminal success |
| Transient | `retry_scheduled` | Retry with full jitter |
| Rate limited | `retry_scheduled` | Retry with full jitter |
| Timeout after body write | `unknown` | Reconciler checks the provider |
| Permanent | `failed` | Dead letter |
| Invalid recipient | `failed` | Dead letter and suppression |
| Opt-out at send time | `suppressed` | Terminal failure |

Retry delay is `random() * min(30 minutes, 30 seconds * 2^(attempt-1))`. Email, push, and in-app get five attempts. SMS gets three.

The notification state is recomputed from all deliveries. A success exists and nothing is pending means `delivered`. Nothing is pending and nothing succeeded means `failed`. A mix with pending work means `partially_delivered`. All suppressed means `suppressed`.

## Campaigns

A campaign has a template, channel, structured audience, optional schedule, payload, rate limit, and creator.

The runner:

1. Finds `running` campaigns.
2. Materializes the audience across shards with `createMany(skipDuplicates)` and a unique `(campaign_id, user_id)` constraint.
3. Selects pending recipients in batches.
4. Re-reads campaign status before each batch so pause stops new emissions.
5. Calls `ingestEvent` with source `growth`, type `campaign.message`, and key `campaign:<campaign_id>:<user_id>`.
6. Marks the recipient `queued` with the notification ID.

The orchestrator restricts a campaign event to the campaign channel through `data.campaign_channel`. The underlying event type still goes through validation, idempotency, preference checks, quiet hours, caps, and suppression.

Recipient state is synchronized from notification transitions: queued, sent, delivered, failed, or suppressed. The funnel is a group count over `campaign_recipients`.

## In-app inbox

The in-app adapter marks the delivery delivered. In the same transaction, the delivery use case inserts one `inbox_items` row with a unique `(user_id, notification_id)` constraint and a per-shard sequence.

After commit, the worker publishes the item to Redis channel `inbox:events:<user_id>`. Connected SSE clients receive it. Offline clients fetch the same item from Postgres or reconnect with `Last-Event-ID` and replay rows with a higher sequence.

There is no presence state and no WebSocket gateway.

## Webhooks

`POST /v1/webhooks/:provider` takes the raw body and verifies:

```
HMAC-SHA256(secret, timestamp + "." + rawBody)
```

The timestamp must be within five minutes. The provider event ID is unique per provider. A duplicate returns `202` and is ignored. A callback can move `accepted` to `delivered` or `failed`. A callback after a terminal failure or a delivered state is recorded in `provider_events` and the timeline but does not change delivery state.

## Scheduling and reconciliation

The scheduler uses a Postgres advisory lock per shard. It promotes:

- Due retry schedules into delivery work.
- Deferred notifications into event messages.
- Scheduled campaigns into `running`.

The reconciler only inspects deliveries in `unknown` for at least 30 seconds. The mock status resolver confirms mock provider IDs. A delivery without a provider message ID fails reconciliation with a permanent `missing_provider_id` code.

## Retention

The retention job deletes expired inbox rows and aged published or terminal rows in batches. The local schema is not partitioned because Prisma relations need stable primary keys. The production plan in `docs/CAPACITY.md` moves the append-heavy tables to monthly or daily partitions with composite keys and drops partitions instead of deleting rows. The API behavior and the retention interface stay the same.

## Sharding

`users.id = UUIDv5(external_id)`.

`shard = sha256(user_id) first 32 bits % SHARD_COUNT`.

Local mode uses one shard. Design mode uses twelve. `getPrismaForUser` returns a cached client for the user's shard. Ops reads fan out across configured shards. Consumer reads are shard-local.

Catalog tables are small and replicated to every shard in the production plan. Locally they live on shard zero.

Cross-shard uniqueness is not available. The idempotency key, campaign recipient key, and inbox uniqueness are all scoped to a user, which matches the shard key.

## Configuration

`packages/config` validates the environment with Zod at startup. The process fails with a list of invalid values. Production refuses the development JWT secret or API key pepper.

Important values:

| Variable | Default |
|---|---|
| `PORT` | `3000` |
| `DATABASE_URL` | `postgresql://herald:herald@localhost:5433/herald` |
| `SHARD_COUNT` | `1` |
| `SHARD_DATABASE_URLS` | empty |
| `REDIS_URL` | `redis://localhost:6379` |
| `KAFKA_BROKERS` | `localhost:9092` |
| `KAFKA_PARTITIONS` | `6` |
| `WORKER_ROLES` | all roles |
| `DEMO_MODE` | `true` |
| `ALLOW_CRITICAL_WHEN_PAUSED` | `true` |

See `.env.example` for the full list.

## Error model

Every API error has the same shape:

```json
{
  "error": {
    "code": "idempotency_conflict",
    "message": "Idempotency key reused with a different payload",
    "details": {}
  },
  "trace_id": "0199f3f2-7d4a-7c3e-9b1a-2f6e5d4c3b2a"
}
```

Codes are stable. Controllers throw `AppError`; the central middleware maps it to the envelope. Validation errors add an `errors` array with field, code, and message. Rate-limited and unavailable responses set `Retry-After`.

## What is intentionally absent

- No CDC connector. The relay is application code.
- No tenant tables or row-level security. There is one company; isolation is by user.
- No provider plugin runtime. Adapters are reviewed code.
- No global ordering. Ordering is per user partition.
- No exactly-once provider write. Idempotency plus reconciliation is the contract.
