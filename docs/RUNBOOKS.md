# Runbooks

The build emits metrics and logs but does not run Alertmanager or a paging rotation. These are the checks and actions an operator would use.

## Common commands

```bash
pnpm herald health
pnpm herald stats
pnpm herald trace <notification-id>
pnpm herald dlq list
pnpm herald notifications list --status failed
docker compose logs api worker --tail 200
```

## Ingest errors

Alert expression:

```promql
sum(rate(herald_events_rejected_total[5m]))
/
sum(rate(herald_events_accepted_total[5m]) + rate(herald_events_rejected_total[5m]))
```

Threshold: above 1 percent for 10 minutes.

First checks:

1. `pnpm herald stats` for the rejected reasons.
2. Group logs by `error.code` and `source`.
3. Check whether a source paused itself or an operator paused it with `herald source pause`.
4. Check whether a producer deployed a schema that no longer matches the event type.
5. Check whether the outbox backlog threshold is returning `503`.

Mitigation:

- Roll back the producer schema or create a new event type version.
- Resume the source if the pause was accidental.
- Drain the outbox before raising `OUTBOX_MAX_PENDING_ROWS`.
- Do not disable validation. Fix the producer.

## Outbox lag

Alert:

```promql
herald_outbox_oldest_age_seconds > 30
```

for 5 minutes.

First checks:

```bash
pnpm herald stats
pnpm herald health
docker compose logs worker --tail 100
```

Look for:

- Relay publish errors in worker logs.
- Kafka broker availability.
- A relay role missing from `WORKER_ROLES`.
- A paused or failed outbox row with a high attempt count.

Mitigation:

- Restart the relay role.
- Restore Kafka connectivity.
- If a single row is poisoned, inspect `last_error`, fix the payload, and retry it manually. Do not mark rows published without publishing them.
- Watch `herald_outbox_pending` until it returns to baseline.

## Kafka consumer lag

Alert:

```promql
herald_kafka_consumer_lag > 10000
```

for 10 minutes.

First checks:

1. Identify the topic and group from the metric labels.
2. Check whether the matching worker role is running.
3. Check provider token bucket state. An empty bucket pauses delivery on purpose.
4. Check for repeated consumer rebalances in broker logs.

Mitigation:

- Add worker instances for the lagging priority.
- Raise the provider bucket only if the provider can accept it.
- For a stuck partition, restart the consumer group after confirming in-flight work is safe. Delivery claims and outbox rows make redelivery harmless.

## DLQ growth

Alert:

```promql
delta(herald_dlq_depth[1h]) > 100
```

First checks:

```bash
pnpm herald dlq list
pnpm herald dlq show <id>
```

Group by `error_class` and `error_code`. Common causes:

- `invalid_recipient`: bad address or expired device token. Suppress the address.
- `permanent`: provider rejected the payload. Fix the template or event data.
- `auth`: provider credential problem. Rotate the credential and open the circuit.
- `template_variables_missing`: producer omitted a variable or the template changed.

Mitigation:

1. Fix the cause.
2. `pnpm herald dlq replay <id>` to inspect the dry run.
3. `pnpm herald dlq replay <id> --apply` to publish it again.
4. `pnpm herald dlq discard <id> --reason "..."` only when the message must not be sent.

## Provider outage

Alert:

```promql
sum(rate(herald_deliveries_total{status="failed"}[5m]))
/
sum(rate(herald_deliveries_total[5m])) > 0.02
```

for 10 minutes.

First checks:

1. `pnpm herald stats` for the failing channel and provider.
2. `pnpm herald dlq list` and group error classes.
3. Mailpit or the provider console for accepted messages.
4. Circuit state metric. An open circuit is intentional.

Mitigation:

- If the provider returns 5xx, let retries and the circuit breaker handle it. Do not increase the retry rate.
- If the provider returns 429, lower the token bucket refill rate.
- If the provider returns auth errors, rotate the credential and keep the circuit open until a probe succeeds.
- If the failure is permanent, stop retrying and fix the payload or recipient.
- If the backlog is too large, pause the source for non-critical traffic so critical events keep their capacity.

## Retry budget

Alert:

```promql
herald_retry_budget_ratio > 0.10
```

for 5 minutes.

The retry budget is retries divided by channel traffic. Above 10 percent, new retries are delayed. Check the provider before changing the budget. A retry storm usually means an upstream outage or an over-aggressive bucket.

## Database failover

Run:

```bash
pnpm herald failover --dry-run
```

Then follow `docs/DRILLS.md`. During a real incident:

1. Stop writers or put the API in maintenance mode.
2. Confirm the standby lag is near zero.
3. Promote the standby.
4. Point `DATABASE_URL` at the promoted node.
5. Restart the API and worker.
6. Confirm the outbox relay drains unpublished rows.
7. Send one event and follow its trace.

Do not run the drill against a database with data you cannot recreate.

## Redis loss

Symptoms:

- Rate limit counters reset.
- Dedupe falls back to the Postgres unique constraint.
- SSE clients miss live events until reconnect.
- Token buckets refill from capacity.

No accepted event is lost. Restart Redis, confirm `/health/ready`, and watch for a short burst of duplicate work. The outbox and unique constraints make it safe.

## Kafka loss

Symptoms:

- The relay cannot publish and the outbox grows.
- Workers stop receiving messages.
- Ingest continues until the outbox thresholds are crossed, then returns `503`.

Actions:

1. Restore the broker.
2. Confirm topics and consumer groups.
3. Let the relay publish the backlog.
4. Watch consumer lag return to baseline.

The API does not acknowledge an event that only exists in a failed Kafka producer. It acknowledges the Postgres commit. That is the point of the outbox.

## Disk pressure

Postgres:

- Check the largest tables and partition sizes.
- Run `pnpm herald retention run --dry-run` to list what would be deleted.
- Drop expired partitions before deleting rows.

Kafka:

- Reduce retention only after confirming consumers are caught up.
- Add broker storage before reducing retention.

## Clock skew

Webhook signatures depend on a five minute window. If `herald doctor` reports clock skew, fix NTP before debugging signatures.

## Escalation notes

Record the trace ID, notification ID, delivery ID, source, channel, and provider for every incident. The trace endpoint is the fastest path from a user report to the exact attempt that failed.
