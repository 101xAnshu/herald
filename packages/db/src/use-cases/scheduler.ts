import type { DeliveryMessage, EventEnvelope, Priority } from "@herald/contracts";
import { newId } from "@herald/core";
import { loadConfig } from "@herald/config";
import type { Prisma } from "../generated/prisma/client";
import { getPrisma } from "../prisma";
import {
  channelFromDb,
  priorityFromDb,
  sourceFromDb,
} from "../mappers";

export interface SchedulerResult {
  retries: number;
  notifications: number;
  campaigns: number;
}

const recoverStaleDeliveries = async (shard: number, batchSize: number): Promise<number> => {
  const db = getPrisma(shard);
  const stale = await db.$queryRaw<Array<{ id: string }>>`
    SELECT d.id
    FROM deliveries d
    WHERE
      (d.status = 'sending' AND d.updated_at <= now() - interval '30 seconds')
      OR (
        d.status = 'pending'
        AND d.created_at <= now() - interval '60 seconds'
        AND NOT EXISTS (
          SELECT 1
          FROM outbox o
          WHERE o.aggregate_type = 'delivery'
            AND o.aggregate_id = d.id
            AND o.published_at IS NOT NULL
        )
      )
    ORDER BY d.updated_at ASC
    LIMIT ${batchSize}
  `;

  let recovered = 0;

  for (const row of stale) {
    const delivery = await db.delivery.findUnique({
      where: { id: row.id },
      include: { notification: true },
    });

    if (!delivery) {
      continue;
    }

    await db.$transaction(async (tx) => {
      const claimed = await tx.delivery.updateMany({
        where: { id: delivery.id, status: { in: ["PENDING", "SENDING"] } },
        data: { status: "RETRY_SCHEDULED", nextAttemptAt: new Date() },
      });

      if (claimed.count === 0) {
        return;
      }

      await tx.retrySchedule.upsert({
        where: { deliveryId: delivery.id },
        create: {
          id: newId(),
          deliveryId: delivery.id,
          channel: delivery.channel,
          dueAt: new Date(),
          attempt: Math.max(1, delivery.attemptCount + 1),
          state: "PENDING",
        },
        update: {
          dueAt: new Date(),
          attempt: Math.max(1, delivery.attemptCount + 1),
          state: "PENDING",
        },
      });

      await tx.notificationEvent.create({
        data: {
          id: newId(),
          notificationId: delivery.notificationId,
          kind: "delivery_reclaimed",
          actor: "scheduler",
          data: {
            delivery_id: delivery.id,
            reason: delivery.status === "SENDING" ? "stale_sending" : "missing_delivery_message",
          },
        },
      });
    });

    recovered += 1;
  }

  return recovered;
};

const recoverUnprocessedNotifications = async (shard: number, batchSize: number): Promise<number> => {
  const db = getPrisma(shard);
  const stale = await db.$queryRaw<Array<{ id: string }>>`
    SELECT n.id
    FROM notifications n
    WHERE n.status = 'accepted'
      AND NOT EXISTS (SELECT 1 FROM fanout_plans f WHERE f.notification_id = n.id)
      AND n.created_at <= now() - interval '60 seconds'
      AND NOT EXISTS (
        SELECT 1
        FROM outbox o
        WHERE o.aggregate_type = 'notification'
          AND o.aggregate_id = n.id
          AND o.published_at IS NOT NULL
      )
    ORDER BY n.created_at ASC
    LIMIT ${batchSize}
  `;

  let recovered = 0;

  for (const row of stale) {
    const notification = await db.notification.findUnique({ where: { id: row.id } });

    if (!notification) {
      continue;
    }

    await db.$transaction(async (tx) => {
      const priority = priorityFromDb(notification.priority);
      const payload: EventEnvelope = {
        notification_id: notification.id,
        user_id: notification.userId,
        source: sourceFromDb(notification.source),
        type: notification.eventType,
        schema_version: notification.eventVersion,
        priority,
        idempotency_key: notification.idempotencyKey,
        data: (notification.payload ?? {}) as Record<string, unknown>,
        trace_id: notification.traceId,
        shard,
        created_at: notification.createdAt.toISOString(),
      };

      await tx.outbox.create({
        data: {
          id: newId(),
          aggregateType: "notification",
          aggregateId: notification.id,
          shard,
          topic: `herald.events.${priority}.v1`,
          partitionKey: notification.userId,
          payload: payload as unknown as Prisma.InputJsonValue,
          headers: {
            trace_id: notification.traceId,
            notification_id: notification.id,
            priority,
            source: sourceFromDb(notification.source),
            schema_version: notification.eventVersion,
            shard,
          },
        },
      });

      await tx.notificationEvent.create({
        data: {
          id: newId(),
          notificationId: notification.id,
          kind: "event_reclaimed",
          actor: "scheduler",
          data: { reason: "missing_event_message" },
        },
      });
    });

    recovered += 1;
  }

  return recovered;
};

const promoteRetries = async (shard: number, batchSize: number): Promise<number> => {
  const db = getPrisma(shard);
  const due = await db.retrySchedule.findMany({
    where: { state: "PENDING", dueAt: { lte: new Date() } },
    include: { delivery: { include: { notification: true } } },
    orderBy: { dueAt: "asc" },
    take: batchSize,
  });

  let promoted = 0;

  for (const schedule of due) {
    const delivery = schedule.delivery;
    const notification = delivery.notification;

    if (["ACCEPTED", "DELIVERED", "FAILED", "CANCELED", "SUPPRESSED"].includes(delivery.status)) {
      await db.retrySchedule.update({
        where: { id: schedule.id },
        data: { state: "CANCELED" },
      });
      continue;
    }

    await db.$transaction(async (tx) => {
      const claimed = await tx.retrySchedule.updateMany({
        where: { id: schedule.id, state: "PENDING" },
        data: { state: "CLAIMED" },
      });

      if (claimed.count === 0) {
        return;
      }

      await tx.delivery.update({
        where: { id: delivery.id },
        data: { status: "RETRY_SCHEDULED", nextAttemptAt: new Date() },
      });

      const priority = priorityFromDb(notification.priority);
      const payload: DeliveryMessage = {
        delivery_id: delivery.id,
        notification_id: notification.id,
        user_id: notification.userId,
        channel: channelFromDb(delivery.channel),
        priority,
        source: sourceFromDb(notification.source),
        trace_id: notification.traceId,
        shard,
      };

      await tx.outbox.create({
        data: {
          id: newId(),
          aggregateType: "delivery",
          aggregateId: delivery.id,
          shard,
          topic: `herald.deliveries.${priority}.v1`,
          partitionKey: notification.userId,
          payload: payload as unknown as Prisma.InputJsonValue,
          headers: {
            trace_id: notification.traceId,
            notification_id: notification.id,
            delivery_id: delivery.id,
            priority,
            source: sourceFromDb(notification.source),
            shard,
          },
        },
      });

      await tx.notificationEvent.create({
        data: {
          id: newId(),
          notificationId: notification.id,
          kind: "retry_promoted",
          actor: "scheduler",
          data: { delivery_id: delivery.id, attempt: schedule.attempt },
        },
      });
    });

    promoted += 1;
  }

  return promoted;
};

const promoteNotifications = async (shard: number, batchSize: number): Promise<number> => {
  const db = getPrisma(shard);
  const due = await db.notification.findMany({
    where: { status: "SCHEDULED", scheduledFor: { lte: new Date() } },
    orderBy: { scheduledFor: "asc" },
    take: batchSize,
  });

  let promoted = 0;

  for (const notification of due) {
    await db.$transaction(async (tx) => {
      const claimed = await tx.notification.updateMany({
        where: { id: notification.id, status: "SCHEDULED" },
        data: { status: "ACCEPTED", scheduledFor: null },
      });

      if (claimed.count === 0) {
        return;
      }

      const priority = priorityFromDb(notification.priority) as Priority;
      const payload: EventEnvelope = {
        notification_id: notification.id,
        user_id: notification.userId,
        source: sourceFromDb(notification.source),
        type: notification.eventType,
        schema_version: notification.eventVersion,
        priority,
        idempotency_key: notification.idempotencyKey,
        data: (notification.payload ?? {}) as Record<string, unknown>,
        trace_id: notification.traceId,
        shard,
        created_at: notification.createdAt.toISOString(),
      };

      await tx.outbox.create({
        data: {
          id: newId(),
          aggregateType: "notification",
          aggregateId: notification.id,
          shard,
          topic: `herald.events.${priority}.v1`,
          partitionKey: notification.userId,
          payload: payload as unknown as Prisma.InputJsonValue,
          headers: {
            trace_id: notification.traceId,
            notification_id: notification.id,
            priority,
            source: sourceFromDb(notification.source),
            schema_version: notification.eventVersion,
            shard,
          },
        },
      });

      await tx.notificationEvent.create({
        data: {
          id: newId(),
          notificationId: notification.id,
          kind: "scheduler_promoted",
          actor: "scheduler",
          data: {},
        },
      });
    });

    promoted += 1;
  }

  return promoted;
};

const startCampaigns = async (shard: number): Promise<number> => {
  const result = await getPrisma(shard).campaign.updateMany({
    where: { status: "SCHEDULED", scheduledFor: { lte: new Date() } },
    data: { status: "RUNNING", startedAt: new Date() },
  });

  return result.count;
};

export const runSchedulerJobs = async (
  batchSize = 100,
  options: { recover?: boolean } = {},
): Promise<SchedulerResult> => {
  const config = loadConfig();
  let retries = 0;
  let notifications = 0;
  let campaigns = 0;

  for (let shard = 0; shard < config.shardCount; shard += 1) {
    const db = getPrisma(shard);
    const locked = await db.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_lock(hashtext('herald:scheduler')) AS locked
    `;

    if (!locked[0]?.locked) {
      continue;
    }

    try {
      if (options.recover ?? true) {
        await recoverStaleDeliveries(shard, batchSize);
        await recoverUnprocessedNotifications(shard, batchSize);
      }

      retries += await promoteRetries(shard, batchSize);
      notifications += await promoteNotifications(shard, batchSize);
      campaigns += await startCampaigns(shard);
    } finally {
      await db.$queryRaw`SELECT pg_advisory_unlock(hashtext('herald:scheduler'))`;
    }
  }

  return { retries, notifications, campaigns };
};

export const promoteSingleRetry = async (deliveryId: string): Promise<boolean> => {
  const config = loadConfig();

  for (let shard = 0; shard < config.shardCount; shard += 1) {
    const db = getPrisma(shard);
    const schedule = await db.retrySchedule.findUnique({ where: { deliveryId } });

    if (!schedule) {
      continue;
    }

    await db.retrySchedule.update({
      where: { deliveryId },
      data: { dueAt: new Date(), state: "PENDING" },
    });

    await db.delivery.update({
      where: { id: deliveryId },
      data: { status: "RETRY_SCHEDULED", nextAttemptAt: new Date() },
    });

    return true;
  }

  return false;
};
