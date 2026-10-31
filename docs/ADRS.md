# Architecture decisions

Short records for the choices that shape the build.

## ADR-001: Kafka is the transport

**Decision.** Use Kafka topics for events and deliveries, with one topic and consumer group per priority.

**Why.** The design needs replay, independent consumer groups, partition-level ordering by user, and visible lag. A database queue can imitate some of that but not all of it with one operational model.

**Consequence.** One more local service and one more failure mode. The publisher and consumer are behind interfaces, so a smaller deployment could swap transports.

## ADR-002: Transactional outbox without CDC

**Decision.** Write an outbox row in the ingest transaction and publish it from a relay using `FOR UPDATE SKIP LOCKED`.

**Why.** A relay is application code. Debezium would add a connector, another process, and another configuration surface to a local demo.

**Consequence.** At-least-once publish. The orchestrator must be idempotent, and it is, through a unique fanout plan and conditional status updates.

## ADR-003: Shard Postgres by user ID

**Decision.** Derive `users.id` as UUIDv5 from `external_id` and choose the shard with `sha256(user_id) % SHARD_COUNT`.

**Why.** A producer knows the external recipient ID, not an internal shard. Deterministic user IDs remove a global directory from the ingest path.

**Consequence.** Cross-shard queries fan out. There is no global unique index. Every hot table carries `user_id`.

## ADR-004: SSE instead of WebSocket

**Decision.** Use Server-Sent Events for live in-app delivery and Postgres for durable inbox state.

**Why.** SSE is one HTTP response, survives proxies, and needs no gateway, presence registry, or connection count. Offline correctness comes from the durable row, not from the socket.

**Consequence.** Server to client only. That is all the inbox needs.

## ADR-005: Narrow Postgres failover drill

**Decision.** Prove streaming replication, standby promotion, application restart, and outbox replay. Do not build a second region.

**Why.** A full regional failover requires MirrorMaker, a second Kafka, a second Redis, DNS control, and a much larger operational story. The narrow drill still tests the part most likely to lose accepted events: the database write path.

**Consequence.** The docs say clearly what is not covered. The drill is not a regional disaster plan.

## ADR-006: Campaigns use the ingest service

**Decision.** The campaign runner calls `ingestEvent` directly in-process instead of posting to the API or writing notifications itself.

**Why.** A second write path would drift from validation, idempotency, and outbox behavior. Reuse is the correctness argument.

**Consequence.** Campaign throughput is bounded by the ingest transaction and the low-priority topic. That is intentional.

## ADR-007: Instrumentation without a backend

**Decision.** Emit Prometheus metrics, Pino JSON logs, and trace IDs. Do not run Prometheus, Grafana, Loki, Tempo, or OTel Collector.

**Why.** The interesting engineering is the pipeline, not operating an observability stack. The signals are still there for any real backend to scrape.

**Consequence.** No dashboards or alerts out of the box. `docs/RUNBOOKS.md` gives the queries and thresholds.

## ADR-008: Node, pnpm, Vitest, Prisma

**Decision.** One runtime, one package manager, one test runner, one ORM.

**Why.** A second runtime or test framework adds setup cost without improving the demo. Prisma gives typed queries and migrations; the hot raw SQL paths are explicit.

**Consequence.** Prisma is not used for partition maintenance or the outbox claim. Those are reviewed SQL.

## ADR-009: Real email, mock push and SMS

**Decision.** Send email over SMTP to Mailpit. Implement push and SMS as deterministic mocks.

**Why.** Email is the channel a reviewer can inspect end to end without a vendor key. Push and SMS vendor accounts would add secrets and external state for little additional evidence.

**Consequence.** The push and SMS adapters prove the pipeline and failure paths, not vendor integration.

## ADR-010: Static landing page

**Decision.** The public front door is HTML and CSS with no build step.

**Why.** The product is the API, worker, and CLI. A framework for one page would be another dependency to maintain.

**Consequence.** No routing, no server rendering, no CMS. That is acceptable for this project.

## ADR-011: One worker image, role selection

**Decision.** Build one worker image and choose roles through `WORKER_ROLES`.

**Why.** Seven images with nearly identical dependencies would add build time and drift. The role list is explicit and validated.

**Consequence.** A single process can host every role locally. Production should split roles by priority and function so one noisy role cannot consume another's CPU.

## ADR-012: Local schema stays unpartitioned

**Decision.** The local Prisma schema uses ordinary tables. Partitioning is documented as the production plan rather than applied locally.

**Why.** PostgreSQL partitioned tables require the partition key in every primary and unique key. Prisma relations and the idempotency constraint would need composite keys throughout, which makes the local build harder to read without changing the API contract. The capacity document describes daily partitions and partition drops for the design envelope.

**Consequence.** Local retention deletes rows in batches instead of dropping partitions. At design scale, partitioning is mandatory and the retention job must switch to partition management.

## ADR-013: Four API workers in one container

**Decision.** The API container runs four Node worker processes through `API_WORKERS`, sharing port 3000 through Node cluster.

**Why.** One Node process saturates one core before the database does. Four processes raised measured ingest from about 170 to 753 events/s on the demo laptop with the same services and durability.

**Consequence.** Each worker has its own Prisma pool and metrics registry. `/metrics` returns the counters for one worker, not the sum. The demo environment uses four because the laptop has eight threads.

## ADR-014: One SQL statement for ingest writes

**Decision.** The notification, accepted timeline event, and outbox row are inserted by one data-modifying CTE. The user lookup and the idempotency pre-read are gone. A unique violation and a foreign-key violation are mapped to the existing duplicate and unknown-recipient responses.

**Why.** The previous path used several sequential queries and a transaction round trip per accepted event. The single statement cut the hot path enough to raise measured throughput from about 170 to 729 events/s at a 1,000/s target.

**Consequence.** The insert bypasses Prisma model writes, so it must stay in sync with the table columns. The database unique constraint, not a pre-read, remains the idempotency authority.

## ADR-015: Invalidate caches over Redis pub/sub

**Decision.** API key, source control, event type, and backlog caches keep short TTLs and also listen on a Redis pub/sub channel. A mutation publishes the affected cache type, and every API worker and the worker process clears its local cache.

**Why.** The first optimization cached these reads for 1 to 5 seconds. That cut database work but let a revoked key or paused source stay active until the TTL expired. Pub/sub removes that window without adding a per-request read.

**Consequence.** If Redis is unavailable, invalidation falls back to the TTL. The API key cache can still outlive a revocation by the TTL in that failure mode. Event type and source changes are immediate while Redis is healthy.
