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
import type { Prisma } from "../generated/prisma/client";
import { getPrismaForUser } from "../prisma";
import { shardForUser } from "../shard";
import { priorityToDb, sourceToDb } from "../mappers";
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

export const ingestEvent = async (input: IngestInput): Promise<IngestResult> => {
  const config = loadConfig();
  const userId = userIdFromExternalId(input.event.recipient.external_id);
  const db = getPrismaForUser(userId);

  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });

  if (!user) {
    throw new AppError("unknown_recipient", "Recipient not found", 422, {
      details: { external_id: input.event.recipient.external_id },
    });
  }

  const eventType = await getEventType(db, input.event.type, input.event.schema_version);

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
  const sourceControl = await db.sourceControl.findUnique({ where: { source } });

  if (
    sourceControl?.paused &&
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

  const existing = await db.notification.findUnique({
    where: {
      userId_source_idempotencyKey: {
        userId,
        source,
        idempotencyKey: input.event.idempotency_key,
      },
    },
  });

  if (existing) {
    if (existing.requestHash !== hash) {
      throw new AppError("idempotency_conflict", "Idempotency key reused with a different payload", 409);
    }

    return {
      notificationId: existing.id,
      status: "accepted",
      traceId: input.traceId,
      duplicate: true,
    };
  }

  const [pendingCount, oldest] = await Promise.all([
    db.outbox.count({ where: { status: "PENDING" } }),
    db.outbox.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);

  const oldestAgeSeconds = oldest
    ? Math.floor((Date.now() - oldest.createdAt.getTime()) / 1000)
    : 0;

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
  const shard = shardForUser(userId, config.shardCount);

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

  try {
    await db.$transaction(async (tx) => {
      const raced = await tx.notification.findUnique({
        where: {
          userId_source_idempotencyKey: {
            userId,
            source,
            idempotencyKey: input.event.idempotency_key,
          },
        },
      });

      if (raced) {
        if (raced.requestHash !== hash) {
          throw new AppError(
            "idempotency_conflict",
            "Idempotency key reused with a different payload",
            409,
          );
        }

        return;
      }

      await tx.notification.create({
        data: {
          id: notificationId,
          userId,
          source,
          eventType: input.event.type,
          eventVersion: input.event.schema_version,
          priority: priorityToDb(priority),
          idempotencyKey: input.event.idempotency_key,
          requestHash: hash,
          payload: input.event.data as Prisma.InputJsonValue,
          traceId: input.traceId,
          createdAt: now,
        },
      });

      await tx.notificationEvent.create({
        data: {
          id: newId(),
          notificationId,
          kind: "accepted",
          actor: input.actor ?? "api",
          data: {
            source: input.source,
            priority,
            event_type: input.event.type,
            trace_id: input.traceId,
          },
          createdAt: now,
        },
      });

      await tx.outbox.create({
        data: {
          id: newId(),
          aggregateType: "notification",
          aggregateId: notificationId,
          shard,
          topic: topicFor(priority),
          partitionKey: userId,
          payload: payload as Prisma.InputJsonValue,
          headers: {
            trace_id: input.traceId,
            notification_id: notificationId,
            priority,
            source: input.source,
            schema_version: input.event.schema_version,
            shard,
          },
          createdAt: now,
          availableAt: now,
        },
      });
    });
  } catch (error) {
    const isUniqueViolation =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: unknown }).code === "P2002";

    if (!isUniqueViolation) {
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
