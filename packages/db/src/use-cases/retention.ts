import { loadConfig } from "@herald/config";
import type { NotificationStatus } from "../generated/prisma/enums";
import { getPrisma } from "../prisma";

export interface RetentionResult {
  dry_run: boolean;
  inbox_items: number;
  deliveries: number;
  notifications: number;
  outbox: number;
  provider_events: number;
  audit_log: number;
}

const DAY = 86_400_000;

export const runRetention = async (options: { dryRun?: boolean } = {}): Promise<RetentionResult> => {
  const config = loadConfig();
  const dryRun = options.dryRun ?? false;
  const now = Date.now();
  const result: RetentionResult = {
    dry_run: dryRun,
    inbox_items: 0,
    deliveries: 0,
    notifications: 0,
    outbox: 0,
    provider_events: 0,
    audit_log: 0,
  };

  for (let shard = 0; shard < config.shardCount; shard += 1) {
    const db = getPrisma(shard);

    const inboxWhere = { expiresAt: { lte: new Date(now) } };
    const outboxWhere = {
      status: "PUBLISHED" as const,
      publishedAt: { lte: new Date(now - 7 * DAY) },
    };
    const providerWhere = { receivedAt: { lte: new Date(now - 30 * DAY) } };
    const auditWhere = { createdAt: { lte: new Date(now - 365 * DAY) } };
    const notificationWhere = {
      createdAt: { lte: new Date(now - 14 * DAY) },
      status: { in: ["DELIVERED", "FAILED", "CANCELED", "SUPPRESSED"] as NotificationStatus[] },
    };
    const deliveryWhere = { createdAt: { lte: new Date(now - 14 * DAY) } };

    if (dryRun) {
      const [inbox, deliveries, notifications, outbox, providerEvents, audit] = await Promise.all([
        db.inboxItem.count({ where: inboxWhere }),
        db.delivery.count({ where: deliveryWhere }),
        db.notification.count({ where: notificationWhere }),
        db.outbox.count({ where: outboxWhere }),
        db.providerEvent.count({ where: providerWhere }),
        db.auditLog.count({ where: auditWhere }),
      ]);

      result.inbox_items += inbox;
      result.deliveries += deliveries;
      result.notifications += notifications;
      result.outbox += outbox;
      result.provider_events += providerEvents;
      result.audit_log += audit;
      continue;
    }

    result.inbox_items += (await db.inboxItem.deleteMany({ where: inboxWhere })).count;
    result.notifications += (await db.notification.deleteMany({ where: notificationWhere })).count;
    result.deliveries += (await db.delivery.deleteMany({ where: deliveryWhere })).count;
    result.outbox += (await db.outbox.deleteMany({ where: outboxWhere })).count;
    result.provider_events += (await db.providerEvent.deleteMany({ where: providerWhere })).count;
    result.audit_log += (await db.auditLog.deleteMany({ where: auditWhere })).count;
  }

  return result;
};
