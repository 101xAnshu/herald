# Failover drill

The drill is intentionally narrow. It proves streaming replication, standby promotion, application restart, and outbox replay for the Postgres data plane. It does not prove a regional disaster.

## Topology

```
+-------------------+        streaming replication        +-------------------+
|  postgres-primary | -------------------------------->  |  postgres-standby |
|  shard 0          |                                    |  shard 0          |
+---------+---------+                                    +---------+---------+
          |                                                        |
   API + worker (default stack)                          API + worker (dr profile)
          |                                                        |
          +--------------------- same Kafka -----------------------+
                                same Redis
                                same Mailpit
```

Kafka, Redis, and Mailpit are single instances. The promoted database is reached through a separate API and worker service definition in `compose.dr.yml`.

## Prerequisites

1. The default stack is running with seeded data.
2. Docker can create the standby container and volume.
3. Ports 3001 and 5435 are free.
4. `.herald/demo.env` exists.

## Dry run

```bash
pnpm herald failover --dry-run
```

The API checks:

- `wal_level` is `replica` or `logical`.
- `max_wal_senders` is greater than zero.
- At least one standby is streaming.
- Replication lag is below ten seconds.

The dry run never promotes anything.

## Full drill

```bash
make drill-db
```

The script:

1. Creates the `replicator` role and a replication line in `pg_hba.conf`.
2. Reloads Postgres configuration.
3. Starts `postgres-standby`, which runs `pg_basebackup` and then Postgres in hot standby mode.
4. Waits for `pg_stat_replication` to report a streaming replica.
5. Records the notification count on the primary.
6. Stops the API and worker.
7. Promotes the standby with `pg_promote(true, 60)`.
8. Starts `api-dr` and `worker-dr` against the promoted node.
9. Sends one booking event to port 3001.
10. Waits for the outbox to have no unpublished rows.
11. Records the notification count on the promoted node.
12. Writes `drill-results/latest.md`.

## What the result means

| Field | Meaning |
|---|---|
| Notifications before | Row count on the primary before promotion |
| Notifications after | Row count on the promoted node after the new event |
| Replication lag before promotion | Last observed replay lag |
| Promotion RTO | Time from `pg_promote` to the standby leaving recovery |
| Unpublished outbox rows after replay | Backlog after the new worker runs |
| New event response | The 202 envelope from the promoted API |

RPO is the replication lag at the moment writers stop. The script reports it but does not force it to zero. A production drill would pause writers and wait for the replica to catch up before promotion.

RTO here is promotion time plus application startup. It excludes load balancer changes and DNS TTLs because there is no load balancer in the local stack.

## Expected observations

- The standby rejects writes before promotion.
- After promotion, the former standby accepts writes.
- The API and worker can start against the promoted node without a schema migration because the schema is already replicated.
- The outbox relay publishes rows that were committed before the primary stopped.
- A new event completes end to end on the promoted node.

## Limitations

- Kafka and Redis are not failed over.
- There is no MirrorMaker or second Kafka cluster.
- There is no second Redis.
- There is no region-b or cross-region replication.
- The default stack and the DR stack share the same build artifacts.
- The drill does not test a split-brain scenario or fencing.
- The drill does not measure client reconnection behavior behind a real load balancer.
- The promoted node has the same credentials and secrets as the primary.

## Cleanup

```bash
docker compose -f compose.yml -f compose.dr.yml down -v
```

This removes the standby volume. The default Postgres volume is not removed by the combined file unless it is listed in both files; check `docker compose down` separately if you want to keep the primary data.

## What would change in production

- A managed Postgres service with automated failover, or Patroni with fencing.
- A load balancer or service discovery layer that moves the writer endpoint.
- A secret manager for credentials and provider keys.
- A real RPO and RTO target agreed with the business.
- A test that runs the drill on a schedule against a disposable environment.
- A post-drill audit record with the operator, time, observed lag, and data loss.

## Recorded run

A local run on 2026-10-30 produced:

| Field | Value |
|---|---|
| Notifications before | 1003 |
| Notifications after | 1004 |
| Replication lag before promotion | 0.000043s |
| Promotion time | under 1s |
| Unpublished outbox rows after replay | 0 |
| New event on promoted node | accepted, then delivered |

The promotion completed before the one second timestamp resolution, so the report
shows zero for promotion time. Application RTO is reported separately by the
script. On this machine the API and worker were ready against the promoted node
within a few seconds.

This is a local observation, not a production SLA. The host was a laptop with the
default single-shard stack.
