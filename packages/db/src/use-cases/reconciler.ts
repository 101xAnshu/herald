import {
  aggregateNotificationStatus,
  newId,
  type ProviderStatusResolver,
} from "@herald/core";
import { loadConfig } from "@herald/config";
import { getPrisma } from "../prisma";
import {
  deliveryStatusFromDb,
  notificationStatusToDb,
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
        await tx.delivery.update({
          where: { id: delivery.id },
          data: {
            status: outcome.state === "accepted" ? "ACCEPTED" : outcome.state === "delivered" ? "DELIVERED" : "FAILED",
            deliveredAt: outcome.state === "delivered" ? new Date() : null,
            failedAt: outcome.state === "failed" ? new Date() : null,
          },
        });

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
