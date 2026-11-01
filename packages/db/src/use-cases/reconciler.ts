import type { DeliveryMessage } from "@herald/contracts";
import {
  aggregateNotificationStatus,
  newId,
  type ProviderStatusResolver,
} from "@herald/core";
import { loadConfig } from "@herald/config";
import type { Prisma } from "../generated/prisma/client";
import { getPrisma } from "../prisma";
import { shardForUser } from "../shard";
import {
  channelFromDb,
  deliveryStatusFromDb,
  errorClassToDb,
  notificationStatusToDb,
  priorityFromDb,
  sourceFromDb,
} from "../mappers";
import { syncRecipientStatus } from "./campaigns";

export interface ReconcileResult {
  inspected: number;
  resolved: number;
  unresolved: number;
}

export const reconcileUnknownDeliveries = async (
  resolver: ProviderStatusResolver,
  options: { dryRun?: boolean; olderThanSeconds?: number } = {},
): Promise<ReconcileResult> => {
  const config = loadConfig();
  const dryRun = options.dryRun ?? false;
  const cutoff = new Date(Date.now() - (options.olderThanSeconds ?? 60) * 1000);
  let inspected = 0;
  let resolved = 0;
  let unresolved = 0;

  for (let shard = 0; shard < config.shardCount; shard += 1) {
    const db = getPrisma(shard);
    const deliveries = await db.delivery.findMany({
      where: { status: "UNKNOWN", updatedAt: { lte: cutoff } },
      include: { notification: true },
      orderBy: { updatedAt: "asc" },
      take: 100,
    });

    for (const delivery of deliveries) {
      inspected += 1;

      const outcome = delivery.providerMessageId
        ? await resolver.resolve(delivery.provider, delivery.providerMessageId)
        : ({ state: "failed", errorClass: "permanent", errorCode: "missing_provider_id" } as const);

      if (outcome.state === "unknown") {
        unresolved += 1;
        continue;
      }

      resolved += 1;

      if (dryRun) {
        continue;
      }

      await db.$transaction(async (tx) => {
        const now = new Date();
        const priority = priorityFromDb(delivery.notification.priority);
        const shard = shardForUser(delivery.userId, config.shardCount);

        await tx.delivery.update({
          where: { id: delivery.id },
          data: {
            status: outcome.state === "accepted" ? "ACCEPTED" : outcome.state === "delivered" ? "DELIVERED" : "FAILED",
            deliveredAt: outcome.state === "delivered" ? now : null,
            failedAt: outcome.state === "failed" ? now : null,
          },
        });

        if (outcome.state === "failed") {
          const payload: DeliveryMessage = {
            delivery_id: delivery.id,
            notification_id: delivery.notificationId,
            user_id: delivery.userId,
            channel: channelFromDb(delivery.channel),
            priority,
            source: sourceFromDb(delivery.notification.source),
            trace_id: delivery.notification.traceId,
            shard,
          };

          await tx.deadLetter.create({
            data: {
              id: newId(),
              topic: `herald.deliveries.${priority}.v1`,
              deliveryId: delivery.id,
              notificationId: delivery.notificationId,
              payload: payload as unknown as Prisma.InputJsonValue,
              headers: {
                trace_id: delivery.notification.traceId,
                notification_id: delivery.notificationId,
                delivery_id: delivery.id,
                priority,
                source: sourceFromDb(delivery.notification.source),
                shard,
              },
              attempts: delivery.attemptCount,
              errorClass: errorClassToDb(outcome.errorClass ?? "permanent"),
              errorCode: outcome.errorCode ?? "reconcile_failed",
              createdAt: now,
            },
          });
        }

        await tx.notificationEvent.create({
          data: {
            id: newId(),
            notificationId: delivery.notificationId,
            kind: "reconciled",
            actor: "reconciler",
            data: {
              delivery_id: delivery.id,
              state: outcome.state,
              error_class: outcome.errorClass ?? null,
              error_code: outcome.errorCode ?? null,
            },
          },
        });

        const statuses = await tx.delivery.findMany({
          where: { notificationId: delivery.notificationId },
          select: { status: true },
        });

        const aggregate = aggregateNotificationStatus(
          "processing",
          statuses.map((row) => deliveryStatusFromDb(row.status)),
        );

        await tx.notification.update({
          where: { id: delivery.notificationId },
          data: { status: notificationStatusToDb(aggregate) },
        });

        await syncRecipientStatus(tx, delivery.notificationId, aggregate);
      });
    }
  }

  return { inspected, resolved, unresolved };
};
