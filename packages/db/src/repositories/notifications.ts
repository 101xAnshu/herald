import type {
  DeliveryView,
  NotificationStatus,
  NotificationView,
  Source,
  TraceEntry,
} from "@herald/contracts";
import {
  AppError,
  aggregateNotificationStatus,
  isNotificationTerminal,
  newId,
} from "@herald/core";
import { loadConfig } from "@herald/config";
import type { Delivery, Notification } from "../generated/prisma/client";
import { getPrisma, getPrismaForUser, type Db } from "../prisma";
import {
  channelFromDb,
  deliveryStatusFromDb,
  notificationStatusFromDb,
  notificationStatusToDb,
  priorityFromDb,
  sourceFromDb,
  sourceToDb,
} from "../mappers";

export const notificationToView = (notification: Notification): NotificationView => ({
  id: notification.id,
  user_id: notification.userId,
  source: sourceFromDb(notification.source),
  event_type: notification.eventType,
  event_version: notification.eventVersion,
  priority: priorityFromDb(notification.priority),
  status: notificationStatusFromDb(notification.status),
  idempotency_key: notification.idempotencyKey,
  scheduled_for: notification.scheduledFor?.toISOString() ?? null,
  trace_id: notification.traceId,
  created_at: notification.createdAt.toISOString(),
});

export const deliveryToView = (delivery: Delivery): DeliveryView => ({
  id: delivery.id,
  notification_id: delivery.notificationId,
  channel: channelFromDb(delivery.channel),
  priority: priorityFromDb(delivery.priority),
  status: deliveryStatusFromDb(delivery.status),
  provider: delivery.provider,
  provider_message_id: delivery.providerMessageId,
  attempt_count: delivery.attemptCount,
  next_attempt_at: delivery.nextAttemptAt?.toISOString() ?? null,
  accepted_at: delivery.acceptedAt?.toISOString() ?? null,
  delivered_at: delivery.deliveredAt?.toISOString() ?? null,
  failed_at: delivery.failedAt?.toISOString() ?? null,
});

export interface NotificationFilter {
  source?: Source;
  status?: NotificationStatus;
  userId?: string;
  since?: Date;
  cursor?: { createdAt: Date; id: string };
  limit: number;
}

const whereFor = (filter: Omit<NotificationFilter, "limit">) => ({
  ...(filter.source ? { source: sourceToDb(filter.source) } : {}),
  ...(filter.status ? { status: notificationStatusToDb(filter.status) } : {}),
  ...(filter.userId ? { userId: filter.userId } : {}),
  ...(filter.since ? { createdAt: { gte: filter.since } } : {}),
  ...(filter.cursor
    ? {
        OR: [
          { createdAt: { lt: filter.cursor.createdAt } },
          { createdAt: filter.cursor.createdAt, id: { lt: filter.cursor.id } },
        ],
      }
    : {}),
});

const listOnShard = async (db: Db, filter: NotificationFilter) => {
  const rows = await db.notification.findMany({
    where: whereFor(filter),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: filter.limit + 1,
  });

  return rows;
};

export const listNotifications = async (filter: NotificationFilter) => {
  if (filter.userId) {
    return listOnShard(getPrismaForUser(filter.userId), filter);
  }

  const shards = Array.from({ length: loadConfig().shardCount }, (_value, index) => index);
  const pages = await Promise.all(shards.map((shard) => listOnShard(getPrisma(shard), filter)));

  return pages
    .flat()
    .sort((left, right) => {
      const byTime = right.createdAt.getTime() - left.createdAt.getTime();
      return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
    })
    .slice(0, filter.limit + 1);
};

export const findNotification = async (id: string) => {
  const shards = Array.from({ length: loadConfig().shardCount }, (_value, index) => index);

  for (const shard of shards) {
    const row = await getPrisma(shard).notification.findUnique({
      where: { id },
      include: { fanoutPlan: true, events: { orderBy: { createdAt: "asc" } } },
    });

    if (row) {
      return { db: getPrisma(shard), notification: row };
    }
  }

  return null;
};

export const getNotification = async (id: string) => {
  const found = await findNotification(id);

  if (!found) {
    throw new AppError("not_found", "Notification not found", 404);
  }

  const deliveries = await found.db.delivery.findMany({
    where: { notificationId: id },
    orderBy: { createdAt: "asc" },
  });

  return {
    notification: notificationToView(found.notification),
    deliveries: deliveries.map(deliveryToView),
    events: found.notification.events,
    fanoutPlan: found.notification.fanoutPlan,
  };
};

export const getNotificationTrace = async (id: string) => {
  const found = await findNotification(id);

  if (!found) {
    throw new AppError("not_found", "Notification not found", 404);
  }

  const deliveries = await found.db.delivery.findMany({
    where: { notificationId: id },
    include: {
      attempts: { orderBy: { attempt: "asc" } },
      providerEvents: { orderBy: { receivedAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  const timeline: TraceEntry[] = [];

  for (const event of found.notification.events) {
    timeline.push({
      at: event.createdAt.toISOString(),
      kind: event.kind,
      channel: null,
      status: null,
      attempt: null,
      detail: (event.data ?? {}) as Record<string, unknown>,
    });
  }

  for (const delivery of deliveries) {
    timeline.push({
      at: delivery.createdAt.toISOString(),
      kind: "delivery_created",
      channel: channelFromDb(delivery.channel),
      status: deliveryStatusFromDb(delivery.status),
      attempt: null,
      detail: { delivery_id: delivery.id, provider: delivery.provider },
    });

    for (const attempt of delivery.attempts) {
      timeline.push({
        at: attempt.createdAt.toISOString(),
        kind: "delivery_attempt",
        channel: channelFromDb(delivery.channel),
        status: deliveryStatusFromDb(delivery.status),
        attempt: attempt.attempt,
        detail: {
          result: attempt.result,
          error_class: attempt.errorClass ? attempt.errorClass.toLowerCase() : null,
          error_code: attempt.errorCode,
          latency_ms: attempt.latencyMs,
        },
      });
    }

    for (const webhook of delivery.providerEvents) {
      timeline.push({
        at: webhook.receivedAt.toISOString(),
        kind: "provider_webhook",
        channel: channelFromDb(delivery.channel),
        status: deliveryStatusFromDb(delivery.status),
        attempt: null,
        detail: {
          provider: webhook.provider,
          event_id: webhook.eventId,
          type: webhook.type,
          signature_valid: webhook.signatureValid,
        },
      });
    }
  }

  timeline.sort((left, right) => left.at.localeCompare(right.at));

  return {
    notification: notificationToView(found.notification),
    deliveries: deliveries.map(deliveryToView),
    timeline,
  };
};

export const cancelNotification = async (id: string) => {
  const found = await findNotification(id);

  if (!found) {
    throw new AppError("not_found", "Notification not found", 404);
  }

  const current = notificationStatusFromDb(found.notification.status);

  if (isNotificationTerminal(current)) {
    return { notification: notificationToView(found.notification), canceled_deliveries: 0 };
  }

  const [notification, canceled] = await found.db.$transaction([
    found.db.notification.update({
      where: { id },
      data: { status: "CANCELED" },
    }),
    found.db.delivery.updateMany({
      where: {
        notificationId: id,
        status: { in: ["PENDING", "SENDING", "RETRY_SCHEDULED", "UNKNOWN"] },
      },
      data: { status: "CANCELED", failedAt: new Date() },
    }),
    found.db.notificationEvent.create({
      data: {
        id: newId(),
        notificationId: id,
        kind: "canceled",
        actor: "operator",
        data: {},
      },
    }),
  ]);

  return { notification: notificationToView(notification), canceled_deliveries: canceled.count };
};

export const retryNotification = async (id: string) => {
  const found = await findNotification(id);

  if (!found) {
    throw new AppError("not_found", "Notification not found", 404);
  }

  const deliveries = await found.db.delivery.findMany({
    where: { notificationId: id, status: { in: ["FAILED", "UNKNOWN"] } },
  });

  if (deliveries.length === 0) {
    return { notification: notificationToView(found.notification), retried_deliveries: 0 };
  }

  const now = new Date();

  await found.db.$transaction(async (tx) => {
    for (const delivery of deliveries) {
      await tx.delivery.update({
        where: { id: delivery.id },
        data: {
          status: "RETRY_SCHEDULED",
          nextAttemptAt: now,
          failedAt: null,
        },
      });

      await tx.retrySchedule.upsert({
        where: { deliveryId: delivery.id },
        create: {
          id: newId(),
          deliveryId: delivery.id,
          channel: delivery.channel,
          dueAt: now,
          attempt: delivery.attemptCount + 1,
          state: "PENDING",
        },
        update: { dueAt: now, attempt: delivery.attemptCount + 1, state: "PENDING" },
      });
    }

    const refreshed = await tx.delivery.findMany({
      where: { notificationId: id },
      select: { status: true },
    });

    await tx.notification.update({
      where: { id },
      data: {
        status: notificationStatusToDb(
          aggregateNotificationStatus(
            "processing",
            refreshed.map((delivery) => deliveryStatusFromDb(delivery.status)),
          ),
        ),
      },
    });

    await tx.notificationEvent.create({
      data: {
        id: newId(),
        notificationId: id,
        kind: "operator_retry",
        actor: "operator",
        data: { deliveries: deliveries.map((delivery) => delivery.id) },
      },
    });
  });

  return {
    notification: notificationToView(
      (await found.db.notification.findUnique({ where: { id } })) as Notification,
    ),
    retried_deliveries: deliveries.length,
  };
};

export const deliveriesForNotification = async (id: string) => {
  const found = await findNotification(id);

  if (!found) {
    throw new AppError("not_found", "Notification not found", 404);
  }

  const deliveries = await found.db.delivery.findMany({
    where: { notificationId: id },
    orderBy: { createdAt: "asc" },
  });

  return deliveries.map(deliveryToView);
};
