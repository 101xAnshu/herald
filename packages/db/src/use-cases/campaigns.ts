import type {
  AudienceFilter,
  CampaignCreate,
  CampaignRecipientStatus,
  CampaignStatus,
  NotificationStatus,
  Source,
} from "@herald/contracts";
import { AudienceFilterSchema } from "@herald/contracts";
import { AppError, newId, transitionCampaign } from "@herald/core";
import { loadConfig } from "@herald/config";
import type { Prisma } from "../generated/prisma/client";
import { getPrisma, type Db } from "../prisma";
import {
  campaignStatusFromDb,
  campaignStatusToDb,
  channelToDb,
  recipientStatusFromDb,
  recipientStatusToDb,
} from "../mappers";
import { ingestEvent } from "./ingest";

const audienceWhere = (filter: AudienceFilter, channel: string, now: Date): Prisma.UserWhereInput => {
  const where: Prisma.UserWhereInput = {};

  if (filter.user_ids) {
    where.id = { in: filter.user_ids };
  }

  if (filter.kinds) {
    where.kind = { in: filter.kinds.map((kind) => kind.toUpperCase() as never) };
  }

  if (filter.city) {
    where.city = filter.city;
  }

  if (filter.inactive_days !== undefined) {
    where.lastBookingAt = {
      lte: new Date(now.getTime() - filter.inactive_days * 86_400_000),
    };
  }

  if (filter.marketing_opt_in !== undefined) {
    where.preferences = {
      some: {
        category: "marketing",
        channel: channel as never,
        enabled: filter.marketing_opt_in,
      },
    };

    if (filter.marketing_opt_in) {
      where.OR = [{ settings: null }, { settings: { marketingPaused: false } }];
    }
  }

  return where;
};

export const createCampaign = async (db: Db, input: CampaignCreate, createdBy: string) => {
  const template = await db.template.findUnique({ where: { id: input.template_id } });

  if (!template) {
    throw new AppError("not_found", "Template not found", 404);
  }

  if (template.channel !== channelToDb(input.channel)) {
    throw new AppError("validation_failed", "Template channel does not match campaign channel", 422);
  }

  return db.campaign.create({
    data: {
      id: newId(),
      name: input.name,
      templateId: input.template_id,
      channel: channelToDb(input.channel),
      audience: input.audience as Prisma.InputJsonValue,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      scheduledFor: input.scheduled_for ? new Date(input.scheduled_for) : null,
      rateLimit: input.rate_limit ?? loadConfig().campaignRateLimit,
      createdBy,
    },
  });
};

export const listCampaigns = async (db: Db, status?: CampaignStatus) =>
  db.campaign.findMany({
    where: status ? { status: campaignStatusToDb(status) } : {},
    orderBy: { createdAt: "desc" },
  });

export const getCampaign = async (db: Db, id: string) => {
  const campaign = await db.campaign.findUnique({
    where: { id },
    include: { template: { include: { currentVersion: true } } },
  });

  if (!campaign) {
    throw new AppError("not_found", "Campaign not found", 404);
  }

  return campaign;
};

export const launchCampaign = async (db: Db, id: string) => {
  const campaign = await getCampaign(db, id);
  const current = campaignStatusFromDb(campaign.status);
  const next: CampaignStatus = campaign.scheduledFor ? "scheduled" : "running";
  const transition = transitionCampaign(current, next);

  if (!transition.ok) {
    throw new AppError("validation_failed", "Campaign cannot be launched from its current state", 422, {
      details: { status: current },
    });
  }

  return db.campaign.update({
    where: { id },
    data: {
      status: campaignStatusToDb(next),
      startedAt: next === "running" ? new Date() : campaign.startedAt,
    },
  });
};

const moveCampaign = async (db: Db, id: string, next: CampaignStatus) => {
  const campaign = await getCampaign(db, id);
  const current = campaignStatusFromDb(campaign.status);
  const transition = transitionCampaign(current, next);

  if (!transition.ok) {
    throw new AppError("validation_failed", "Campaign state transition is not allowed", 422, {
      details: { from: current, to: next },
    });
  }

  return db.campaign.update({
    where: { id },
    data: {
      status: campaignStatusToDb(next),
      completedAt: next === "completed" || next === "canceled" || next === "failed" ? new Date() : null,
    },
  });
};

export const pauseCampaign = (db: Db, id: string) => moveCampaign(db, id, "paused");
export const resumeCampaign = (db: Db, id: string) => moveCampaign(db, id, "running");
export const completeCampaign = (db: Db, id: string) => moveCampaign(db, id, "completed");
export const failCampaign = (db: Db, id: string) => moveCampaign(db, id, "failed");

export const cancelCampaign = async (db: Db, id: string) => {
  const campaign = await moveCampaign(db, id, "canceled");

  await db.campaignRecipient.updateMany({
    where: { campaignId: id, status: { in: ["PENDING", "QUEUED"] } },
    data: { status: "CANCELED" },
  });

  return campaign;
};

export const materializeRecipients = async (db: Db, campaignId: string) => {
  const campaign = await getCampaign(db, campaignId);
  const filter = AudienceFilterSchema.parse(campaign.audience);
  const now = new Date();
  const config = loadConfig();
  const where = audienceWhere(filter, campaign.channel as string, now);
  const pageSize = 500;
  let inserted = 0;

  for (let shard = 0; shard < config.shardCount; shard += 1) {
    const shardDb = getPrisma(shard);
    let cursor: string | undefined;

    for (;;) {
      const users = await shardDb.user.findMany({
        where,
        select: { id: true },
        orderBy: { id: "asc" },
        take: pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (users.length === 0) {
        break;
      }

      const result = await shardDb.campaignRecipient.createMany({
        data: users.map((user) => ({
          campaignId,
          userId: user.id,
          shard,
          status: "PENDING",
        })),
        skipDuplicates: true,
      });

      inserted += result.count;
      cursor = users[users.length - 1]?.id;

      if (users.length < pageSize) {
        break;
      }
    }
  }

  return inserted;
};

export interface CampaignRunResult {
  processed: number;
  emitted: number;
  skipped: number;
  campaignStatus: CampaignStatus;
}

export const runCampaignBatch = async (db: Db, campaignId: string): Promise<CampaignRunResult> => {
  const config = loadConfig();
  const campaign = await getCampaign(db, campaignId);
  const status = campaignStatusFromDb(campaign.status);

  if (status !== "running") {
    return { processed: 0, emitted: 0, skipped: 0, campaignStatus: status };
  }

  const recipients = await db.campaignRecipient.findMany({
    where: { campaignId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: config.campaignBatchSize,
    include: { user: { select: { externalId: true } } },
  });

  let emitted = 0;
  let skipped = 0;

  for (const recipient of recipients) {
    const fresh = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { status: true },
    });

    if (!fresh || fresh.status !== "RUNNING") {
      break;
    }

    try {
      const result = await ingestEvent({
        source: "growth" as Source,
        event: {
          type: "campaign.message",
          schema_version: 1,
          recipient: { external_id: recipient.user.externalId },
          idempotency_key: `campaign:${campaignId}:${recipient.userId}`,
          data: {
            campaign_id: campaignId,
            template_key: campaign.template.key,
            template_id: campaign.template.id,
            campaign_channel: campaign.channel.toLowerCase(),
            ...(campaign.payload as Record<string, unknown>),
          },
        },
        traceId: newId(),
        actor: "campaign",
      });

      await db.campaignRecipient.update({
        where: { campaignId_userId: { campaignId, userId: recipient.userId } },
        data: { status: "QUEUED", notificationId: result.notificationId },
      });

      emitted += 1;
    } catch (error) {
      if (error instanceof AppError && error.code === "unknown_recipient") {
        await db.campaignRecipient.update({
          where: { campaignId_userId: { campaignId, userId: recipient.userId } },
          data: { status: "SUPPRESSED" },
        });
        skipped += 1;
        continue;
      }

      throw error;
    }
  }

  const remaining = await db.campaignRecipient.count({
    where: { campaignId, status: "PENDING" },
  });

  let finalStatus: CampaignStatus = status;

  if (remaining === 0) {
    const completed = await completeCampaign(db, campaignId);
    finalStatus = campaignStatusFromDb(completed.status);
  }

  return {
    processed: recipients.length,
    emitted,
    skipped,
    campaignStatus: finalStatus,
  };
};

export const getCampaignStats = async (db: Db, campaignId: string) => {
  const campaign = await getCampaign(db, campaignId);
  const groups = await db.campaignRecipient.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });

  const counts: Record<string, number> = {
    pending: 0,
    queued: 0,
    sent: 0,
    delivered: 0,
    failed: 0,
    suppressed: 0,
    canceled: 0,
  };

  for (const group of groups) {
    counts[recipientStatusFromDb(group.status)] = group._count._all;
  }

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const done = total - (counts.pending ?? 0) - (counts.queued ?? 0);

  return {
    campaign_id: campaignId,
    status: campaignStatusFromDb(campaign.status),
    total,
    pending: counts.pending ?? 0,
    queued: counts.queued ?? 0,
    sent: counts.sent ?? 0,
    delivered: counts.delivered ?? 0,
    failed: counts.failed ?? 0,
    suppressed: counts.suppressed ?? 0,
    canceled: counts.canceled ?? 0,
    progress_ratio: total === 0 ? 0 : Number((done / total).toFixed(4)),
  };
};

export const listCampaignRecipients = async (
  db: Db,
  campaignId: string,
  options: { limit: number; status?: CampaignRecipientStatus; cursor?: string },
) => {
  const cursor = options.cursor
    ? await db.campaignRecipient.findUnique({
        where: { campaignId_userId: { campaignId, userId: options.cursor } },
      })
    : null;

  const rows = await db.campaignRecipient.findMany({
    where: {
      campaignId,
      ...(options.status ? { status: recipientStatusToDb(options.status) } : {}),
    },
    orderBy: { userId: "asc" },
    take: options.limit + 1,
    ...(cursor ? { cursor: { campaignId_userId: { campaignId, userId: cursor.userId } }, skip: 1 } : {}),
  });

  return {
    items: rows.slice(0, options.limit),
    hasMore: rows.length > options.limit,
  };
};

export const syncRecipientStatus = async (
  tx: Prisma.TransactionClient,
  notificationId: string,
  status: NotificationStatus,
): Promise<void> => {
  const recipient = await tx.campaignRecipient.findFirst({ where: { notificationId } });

  if (!recipient) {
    return;
  }

  const mapped: CampaignRecipientStatus =
    status === "delivered"
      ? "delivered"
      : status === "failed"
        ? "failed"
        : status === "suppressed"
          ? "suppressed"
          : status === "canceled"
            ? "canceled"
            : status === "accepted" || status === "scheduled"
              ? "queued"
              : "sent";

  if (recipientStatusFromDb(recipient.status) !== mapped) {
    await tx.campaignRecipient.update({
      where: { campaignId_userId: { campaignId: recipient.campaignId, userId: recipient.userId } },
      data: { status: recipientStatusToDb(mapped) },
    });
  }
};
