import type { FaultInjection, Source } from "@herald/contracts";
import { AppError, newId } from "@herald/core";
import { loadConfig } from "@herald/config";
import type { Prisma } from "../generated/prisma/client";
import { getPrisma } from "../prisma";
import {
  channelToDb,
  sourceToDb,
  sourceFromDb,
} from "../mappers";

export const getOpsStats = async () => {
  const config = loadConfig();
  const notifications: Record<string, number> = {};
  const deliveries: Record<string, number> = {};
  let outboxPending = 0;
  let oldestOutboxAge = 0;
  let dlqDepth = 0;
  let campaignsRunning = 0;
  let dueRetries = 0;

  for (let shard = 0; shard < config.shardCount; shard += 1) {
    const db = getPrisma(shard);

    const [notificationGroups, deliveryGroups, pending, oldest, dlq, running, retries] =
      await Promise.all([
        db.notification.groupBy({ by: ["status"], _count: { _all: true } }),
        db.delivery.groupBy({ by: ["status"], _count: { _all: true } }),
        db.outbox.count({ where: { status: "PENDING" } }),
        db.outbox.findFirst({
          where: { status: "PENDING" },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        }),
        db.deadLetter.count(),
        db.campaign.count({ where: { status: "RUNNING" } }),
        db.retrySchedule.count({ where: { state: "PENDING", dueAt: { lte: new Date() } } }),
      ]);

    for (const group of notificationGroups) {
      const key = group.status.toLowerCase();
      notifications[key] = (notifications[key] ?? 0) + group._count._all;
    }

    for (const group of deliveryGroups) {
      const key = group.status.toLowerCase();
      deliveries[key] = (deliveries[key] ?? 0) + group._count._all;
    }

    outboxPending += pending;
    dlqDepth += dlq;
    campaignsRunning += running;
    dueRetries += retries;
    oldestOutboxAge = Math.max(
      oldestOutboxAge,
      oldest ? Math.floor((Date.now() - oldest.createdAt.getTime()) / 1000) : 0,
    );
  }

  return {
    notifications,
    deliveries,
    outbox: { pending: outboxPending, oldest_age_seconds: oldestOutboxAge },
    dlq: { depth: dlqDepth },
    campaigns: { running: campaignsRunning },
    retries: { due: dueRetries },
    shards: config.shardCount,
  };
};

export const listOutbox = async (options: { limit: number; status?: string }) => {
  const config = loadConfig();
  const rows = [];

  for (let shard = 0; shard < config.shardCount; shard += 1) {
    const page = await getPrisma(shard).outbox.findMany({
      where: options.status ? { status: options.status as never } : {},
      orderBy: { createdAt: "desc" },
      take: options.limit,
    });

    rows.push(...page);
  }

  return rows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(0, options.limit);
};

export const listRetries = async (options: { limit: number; dueOnly?: boolean }) => {
  const config = loadConfig();
  const rows = [];

  for (let shard = 0; shard < config.shardCount; shard += 1) {
    const page = await getPrisma(shard).retrySchedule.findMany({
      where: {
        state: "PENDING",
        ...(options.dueOnly ? { dueAt: { lte: new Date() } } : {}),
      },
      orderBy: { dueAt: "asc" },
      take: options.limit,
      include: { delivery: { include: { notification: true } } },
    });

    rows.push(...page);
  }

  return rows.sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime()).slice(0, options.limit);
};

export const listDlq = async (options: { limit: number; includeDiscarded?: boolean }) => {
  const config = loadConfig();
  const rows = [];

  for (let shard = 0; shard < config.shardCount; shard += 1) {
    const page = await getPrisma(shard).deadLetter.findMany({
      where: options.includeDiscarded ? {} : { discardedAt: null },
      orderBy: { createdAt: "desc" },
      take: options.limit,
    });

    rows.push(...page);
  }

  return rows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(0, options.limit);
};

export const getDlq = async (id: string) => {
  const config = loadConfig();

  for (let shard = 0; shard < config.shardCount; shard += 1) {
    const row = await getPrisma(shard).deadLetter.findUnique({ where: { id } });

    if (row) {
      return { shard, db: getPrisma(shard), record: row };
    }
  }

  throw new AppError("not_found", "Dead letter not found", 404);
};

export const replayDlq = async (
  id: string,
  options: { dryRun: boolean; actor: string },
) => {
  const found = await getDlq(id);

  if (found.record.discardedAt) {
    throw new AppError("validation_failed", "Dead letter was discarded", 422);
  }

  if (options.dryRun) {
    return { dry_run: true, id, topic: found.record.topic, payload: found.record.payload };
  }

  await found.db.$transaction(async (tx) => {
    if (found.record.deliveryId) {
      const delivery = await tx.delivery.findUnique({
        where: { id: found.record.deliveryId },
        select: { id: true, channel: true },
      });

      if (delivery) {
        await tx.delivery.update({
          where: { id: delivery.id },
          data: {
            status: "RETRY_SCHEDULED",
            attemptCount: 0,
            nextAttemptAt: new Date(),
            failedAt: null,
          },
        });

        await tx.retrySchedule.upsert({
          where: { deliveryId: delivery.id },
          create: {
            id: newId(),
            deliveryId: delivery.id,
            channel: delivery.channel,
            dueAt: new Date(),
            attempt: 1,
            state: "PENDING",
          },
          update: { dueAt: new Date(), attempt: 1, state: "PENDING" },
        });
      }
    }

    await tx.outbox.create({
      data: {
        id: newId(),
        aggregateType: "dead_letter",
        aggregateId: id,
        shard: found.shard,
        topic: found.record.topic,
        partitionKey: String((found.record.headers as Record<string, unknown> | null)?.["partition_key"] ?? id),
        payload: found.record.payload as Prisma.InputJsonValue,
        headers: {
          ...(found.record.headers as Record<string, unknown>),
          replay_of: id,
        } as Prisma.InputJsonValue,
      },
    });

    await tx.deadLetter.update({
      where: { id },
      data: { replayedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        id: newId(),
        actorLabel: options.actor,
        action: "dlq.replay",
        resourceType: "dead_letter",
        resourceId: id,
        result: "SUCCESS",
        traceId: newId(),
        metadata: { topic: found.record.topic },
      },
    });
  });

  return { dry_run: false, id, replayed: true };
};

export const discardDlq = async (id: string, reason: string, actor: string) => {
  const found = await getDlq(id);

  await found.db.$transaction([
    found.db.deadLetter.update({
      where: { id },
      data: { discardedAt: new Date(), discardReason: reason },
    }),
    found.db.auditLog.create({
      data: {
        id: newId(),
        actorLabel: actor,
        action: "dlq.discard",
        resourceType: "dead_letter",
        resourceId: id,
        result: "SUCCESS",
        traceId: newId(),
        metadata: { reason },
      },
    }),
  ]);
};

export const setSourcePaused = async (
  source: Source,
  paused: boolean,
  reason: string,
  actor: string,
) => {
  const db = getPrisma(0);
  const sourceValue = sourceToDb(source);

  return db.$transaction(async (tx) => {
    const control = await tx.sourceControl.upsert({
      where: { source: sourceValue },
      create: {
        source: sourceValue,
        paused,
        pausedAt: paused ? new Date() : null,
        pausedBy: paused ? actor : null,
        reason: paused ? reason : null,
      },
      update: {
        paused,
        pausedAt: paused ? new Date() : null,
        pausedBy: paused ? actor : null,
        reason: paused ? reason : null,
      },
    });

    await tx.auditLog.create({
      data: {
        id: newId(),
        actorLabel: actor,
        action: paused ? "source.pause" : "source.resume",
        resourceType: "source",
        resourceId: source,
        result: "SUCCESS",
        traceId: newId(),
        metadata: { reason },
      },
    });

    return control;
  });
};

export const listSources = async () => {
  const rows = await getPrisma(0).sourceControl.findMany();
  return rows.map((row) => ({ source: sourceFromDb(row.source), paused: row.paused, reason: row.reason }));
};

export const listAudit = async (options: { limit: number }) =>
  getPrisma(0).auditLog.findMany({ orderBy: { createdAt: "desc" }, take: options.limit });

export const setProviderFault = async (input: FaultInjection, actor: string) => {
  const db = getPrisma(0);

  return db.$transaction(async (tx) => {
    const fault = await tx.providerFault.upsert({
      where: { provider_channel: { provider: `mock_${input.channel}`, channel: channelToDb(input.channel) } },
      create: {
        id: newId(),
        provider: `mock_${input.channel}`,
        channel: channelToDb(input.channel),
        outcome: input.outcome,
        expiresAt: new Date(Date.now() + input.ttl_seconds * 1000),
      },
      update: {
        outcome: input.outcome,
        expiresAt: new Date(Date.now() + input.ttl_seconds * 1000),
      },
    });

    await tx.auditLog.create({
      data: {
        id: newId(),
        actorLabel: actor,
        action: "provider.fault",
        resourceType: "provider",
        resourceId: fault.provider,
        result: "SUCCESS",
        traceId: newId(),
        metadata: { outcome: input.outcome, ttl_seconds: input.ttl_seconds },
      },
    });

    return fault;
  });
};

export const listProviderFaults = async () =>
  getPrisma(0).providerFault.findMany({ where: { expiresAt: { gt: new Date() } } });

export const replicationStatus = async () => {
  const rows = await getPrisma(0).$queryRaw<
    Array<{
      client_addr: string | null;
      state: string;
      sent_lsn: string | null;
      replay_lsn: string | null;
      lag_seconds: number | null;
    }>
  >`
    SELECT client_addr::text, state, sent_lsn::text, replay_lsn::text,
           EXTRACT(EPOCH FROM replay_lag)::float8 AS lag_seconds
    FROM pg_stat_replication
  `;

  return rows;
};
