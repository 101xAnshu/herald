import { loadConfig } from "@herald/config";
import type { IngestEvent, Priority, Source } from "@herald/contracts";
import {
  AppError,
  newId,
  requestHash,
  resolvePriority,
  userIdFromExternalId,
  validateJsonSchema,
} from "@herald/core";
import { getPrismaForUser } from "../prisma";
import { shardForUser } from "../shard";
import { sourceToDb } from "../mappers";
import { getEventType } from "../repositories/catalog";

export interface IngestInput {
  source: Source;
  event: IngestEvent;
  traceId: string;
  actor?: string;
}

export interface IngestResult {
  notificationId: string;
  status: "accepted";
  traceId: string;
  duplicate: boolean;
}

const topicFor = (priority: Priority): string => `herald.events.${priority}.v1`;

const sourceControlCache = new Map<Source, { paused: boolean; expiresAt: number }>();
const SOURCE_CONTROL_TTL_MS = 1_000;
const backlogCache = new Map<number, { pending: number; oldestAgeSeconds: number; expiresAt: number }>();
const BACKLOG_CACHE_TTL_MS = 500;

export const clearSourceControlCache = (): void => {
  sourceControlCache.clear();
};

export const clearBacklogCache = (): void => {
  backlogCache.clear();
};

const isSourcePaused = async (db: ReturnType<typeof getPrismaForUser>, source: Source) => {
  const cached = sourceControlCache.get(source);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.paused;
  }

  const row = await db.sourceControl.findUnique({ where: { source: sourceToDb(source) } });
  const paused = row?.paused ?? false;

  sourceControlCache.set(source, { paused, expiresAt: Date.now() + SOURCE_CONTROL_TTL_MS });
  return paused;
};

export const ingestEvent = async (input: IngestInput): Promise<IngestResult> => {
  const config = loadConfig();
  const userId = userIdFromExternalId(input.event.recipient.external_id);
  const db = getPrismaForUser(userId);
  const shard = shardForUser(userId, config.shardCount);

  const [eventType, sourcePaused] = await Promise.all([
    getEventType(db, input.event.type, input.event.schema_version),
    isSourcePaused(db, input.source),
  ]);

  if (!eventType) {
    throw new AppError("validation_failed", "Unknown event type or schema version", 422, {
      details: {
        type: input.event.type,
        schema_version: input.event.schema_version,
      },
    });
  }

  const payloadValidation = validateJsonSchema(eventType.schema, input.event.data);

  if (!payloadValidation.ok) {
    throw new AppError("validation_failed", "Event data does not match the catalog schema", 422, {
      errors: payloadValidation.errors.map((issue) => ({
        field: `data.${issue.field}`,
        code: "invalid_payload",
        message: issue.message,
      })),
    });
  }

  if (!eventType.allowed_sources.includes(input.source)) {
    throw new AppError("forbidden", "Source may not send this event type", 403, {
      details: { source: input.source, allowed_sources: eventType.allowed_sources },
    });
  }

  const priorityResult = resolvePriority(
    eventType.default_priority,
    input.event.priority,
    eventType.policy.allow_priority_override,
  );

  if (!priorityResult.ok) {
    throw new AppError("validation_failed", "Priority override is not allowed for this event type", 422);
  }

  const priority = priorityResult.priority;
  const source = sourceToDb(input.source);

  if (
    sourcePaused &&
    !(config.allowCriticalWhenPaused && priority === "critical")
  ) {
    throw new AppError("source_paused", "Source is paused", 409, {
      details: { source: input.source },
    });
  }

  const hash = requestHash({
    type: input.event.type,
    schema_version: input.event.schema_version,
    recipient: input.event.recipient,
    data: input.event.data,
    priority: input.event.priority ?? null,
  });

  const cachedBacklog = backlogCache.get(shard);
  let pendingCount: number;
  let oldestAgeSeconds: number;

  if (cachedBacklog && cachedBacklog.expiresAt > Date.now()) {
    pendingCount = cachedBacklog.pending;
    oldestAgeSeconds = cachedBacklog.oldestAgeSeconds;
  } else {
    const [backlog] = await db.$queryRaw<
      Array<{ pending: number; oldest_age_seconds: number }>
    >`
      SELECT count(*)::int AS pending,
             COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at))), 0)::int AS oldest_age_seconds
      FROM outbox
      WHERE status = 'pending'
    `;

    pendingCount = backlog?.pending ?? 0;
    oldestAgeSeconds = backlog?.oldest_age_seconds ?? 0;
    backlogCache.set(shard, {
      pending: pendingCount,
      oldestAgeSeconds,
      expiresAt: Date.now() + BACKLOG_CACHE_TTL_MS,
    });
  }

  if (
    pendingCount > config.outboxMaxPendingRows ||
    oldestAgeSeconds > config.outboxMaxAgeSeconds
  ) {
    throw new AppError("dependency_unavailable", "Ingest is backpressured", 503, {
      details: { pending_rows: pendingCount, oldest_age_seconds: oldestAgeSeconds },
    });
  }

  const now = new Date();
  const notificationId = newId();

  const payload = {
    notification_id: notificationId,
    user_id: userId,
    source: input.source,
    type: input.event.type,
    schema_version: input.event.schema_version,
    priority,
    idempotency_key: input.event.idempotency_key,
    data: input.event.data,
    trace_id: input.traceId,
    shard,
    created_at: now.toISOString(),
  } satisfies Record<string, unknown>;

  const eventId = newId();
  const outboxId = newId();
  const eventData = {
    source: input.source,
    priority,
    event_type: input.event.type,
    trace_id: input.traceId,
  };
  const headers = {
    trace_id: input.traceId,
    notification_id: notificationId,
    priority,
    source: input.source,
    schema_version: input.event.schema_version,
    shard,
  };

  try {
    await db.$queryRaw<Array<{ id: string }>>`
      WITH created AS (
        INSERT INTO notifications (
          id, user_id, source, event_type, event_version, priority, status,
          idempotency_key, request_hash, payload, trace_id, created_at, updated_at
        )
        VALUES (
          ${notificationId}, ${userId}, ${input.source}::"source", ${input.event.type},
          ${input.event.schema_version}, ${priority}::"priority", 'accepted'::"notification_status",
          ${input.event.idempotency_key}, ${hash}, ${JSON.stringify(input.event.data)}::jsonb,
          ${input.traceId}, ${now}, ${now}
        )
        RETURNING id
      ),
      timeline AS (
        INSERT INTO notification_events (id, notification_id, kind, actor, data, created_at)
        SELECT ${eventId}, id, 'accepted', ${input.actor ?? "api"},
               ${JSON.stringify(eventData)}::jsonb, ${now}
        FROM created
      ),
      queued AS (
        INSERT INTO outbox (
          id, aggregate_type, aggregate_id, shard, topic, partition_key, payload,
          headers, status, attempts, available_at, created_at
        )
        SELECT ${outboxId}, 'notification', id, ${shard}, ${topicFor(priority)}, ${userId},
               ${JSON.stringify(payload)}::jsonb, ${JSON.stringify(headers)}::jsonb,
               'pending'::"outbox_status", 0, ${now}, ${now}
        FROM created
      )
      SELECT id FROM created
    `;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    const driverCode =
      typeof error === "object" && error !== null && "meta" in error
        ? String(
            (error as { meta?: { driverAdapterError?: { cause?: { originalCode?: unknown } } } })
              .meta?.driverAdapterError?.cause?.originalCode ?? "",
          )
        : "";

    if (code === "P2003" || driverCode === "23503") {
      throw new AppError("unknown_recipient", "Recipient not found", 422, {
        details: { external_id: input.event.recipient.external_id },
      });
    }

    if (code !== "P2002" && driverCode !== "23505") {
      throw error;
    }

    const raced = await db.notification.findUnique({
      where: {
        userId_source_idempotencyKey: {
          userId,
          source,
          idempotencyKey: input.event.idempotency_key,
        },
      },
    });

    if (!raced || raced.requestHash !== hash) {
      throw new AppError("idempotency_conflict", "Idempotency key reused with a different payload", 409);
    }

    return {
      notificationId: raced.id,
      status: "accepted",
      traceId: input.traceId,
      duplicate: true,
    };
  }

  return {
    notificationId,
    status: "accepted",
    traceId: input.traceId,
    duplicate: false,
  };
};
