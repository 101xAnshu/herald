import type { Channel, DeliveryMessage, EventEnvelope, NotificationStatus } from "@herald/contracts";
import {
  AppError,
  newId,
  resolveFanoutPolicy,
  selectLocalized,
  transitionNotification,
  type ChannelAvailability,
  type FanoutPolicyResult,
  type PolicyUser,
} from "@herald/core";
import { loadConfig } from "@herald/config";
import type { EventTypeDefinition } from "@herald/contracts";
import type { Prisma } from "../generated/prisma/client";
import { getPrisma, type Db } from "../prisma";
import {
  channelFromDb,
  channelToDb,
  notificationStatusFromDb,
  notificationStatusToDb,
  priorityFromDb,
  priorityToDb,
  sourceFromDb,
} from "../mappers";
import { findTemplateForRecipient, getEventType } from "../repositories/catalog";
import { syncRecipientStatus } from "./campaigns";
import { loadPolicyUser } from "../repositories/users";

const PROVIDERS: Record<Channel, string> = {
  email: "smtp",
  in_app: "in_app",
  push: "mock_push",
  sms: "mock_sms",
};

const DEFAULT_TEMPLATE_KEYS: Record<string, string> = {
  "booking.confirmed": "booking_confirmation",
  "booking.canceled": "booking_cancellation",
  "payment.failed": "payment_failure",
  "security.alert": "security_alert",
  "campaign.message": "winback",
};

const templateKeyFor = (event: EventEnvelope, fallback: string | undefined, eventTypeKey: string): string => {
  const data = event.data as Record<string, unknown>;
  const fromPayload = data.template_key;

  if (typeof fromPayload === "string" && fromPayload.length > 0) {
    return fromPayload;
  }

  return fallback ?? DEFAULT_TEMPLATE_KEYS[eventTypeKey] ?? "generic";
};

const localeCandidatesFor = (locale: string): string[] => {
  const normalized = locale.trim().replaceAll("_", "-").toLowerCase();
  const [language] = normalized.split("-");
  return [...new Set([normalized, language, "en"].filter((value): value is string => Boolean(value)))];
};

const startOfUtcDay = (now: Date): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export interface OrchestrateOptions {
  now?: Date;
  availability?: ChannelAvailability;
}

export interface OrchestrateResult {
  notificationId: string;
  status: NotificationStatus;
  channels: Channel[];
  duplicate: boolean;
}

export const orchestrateNotification = async (
  event: EventEnvelope,
  options: OrchestrateOptions = {},
): Promise<OrchestrateResult> => {
  const config = loadConfig();
  const now = options.now ?? new Date();
  const db = getPrisma(event.shard);
  const notification = await db.notification.findUnique({
    where: { id: event.notification_id },
  });

  if (!notification) {
    throw new AppError("not_found", "Notification not found for orchestration", 404);
  }

  const currentStatus = notificationStatusFromDb(notification.status);

  if (["delivered", "failed", "canceled", "suppressed"].includes(currentStatus)) {
    return {
      notificationId: notification.id,
      status: currentStatus,
      channels: [],
      duplicate: true,
    };
  }

  const existingPlan = await db.fanoutPlan.findUnique({
    where: { notificationId: notification.id },
  });

  if (existingPlan) {
    const deliveries = await db.delivery.findMany({
      where: { notificationId: notification.id },
      select: { channel: true },
    });

    return {
      notificationId: notification.id,
      status: currentStatus,
      channels: deliveries.map((delivery) => channelFromDb(delivery.channel)),
      duplicate: true,
    };
  }

  const eventType = await getEventType(db, notification.eventType, notification.eventVersion);

  if (!eventType) {
    await markTerminal(db, notification.id, notification.traceId, "failed", {
      reason: "event_type_missing",
    });

    return {
      notificationId: notification.id,
      status: "failed",
      channels: [],
      duplicate: false,
    };
  }

  const policyUser = await loadPolicyUser(db, notification.userId, config.apiKeyPepper);

  if (!policyUser) {
    await markTerminal(db, notification.id, notification.traceId, "failed", { reason: "user_missing" });

    return {
      notificationId: notification.id,
      status: "failed",
      channels: [],
      duplicate: false,
    };
  }

  const usageRows = await db.delivery.groupBy({
    by: ["channel"],
    where: {
      userId: notification.userId,
      createdAt: { gte: startOfUtcDay(now) },
      status: { notIn: ["CANCELED", "SUPPRESSED"] },
    },
    _count: { _all: true },
  });

  const usage: Partial<Record<Channel, number>> = {};

  for (const row of usageRows) {
    usage[channelFromDb(row.channel)] = row._count._all;
  }

  const availability: ChannelAvailability = options.availability ?? {
    email: true,
    in_app: true,
    push: true,
    sms: true,
  };

  const priority = priorityFromDb(notification.priority);
  const policy = resolvePolicy(eventType, priority, policyUser, availability, usage, now);

  if (policy.outcome === "scheduled") {
    await scheduleNotification(db, notification.id, notification.traceId, policy);
    return {
      notificationId: notification.id,
      status: "scheduled",
      channels: [],
      duplicate: false,
    };
  }

  if (policy.outcome === "suppressed" || policy.outcome === "failed") {
    const status = policy.outcome;
    await markTerminal(db, notification.id, notification.traceId, status, {
      policy_hash: policy.policyHash,
      channels: policy.channels,
      reason: status === "suppressed" ? "all_channels_suppressed" : "all_channels_unavailable",
    });

    return {
      notificationId: notification.id,
      status,
      channels: [],
      duplicate: false,
    };
  }

  const templateKey = templateKeyFor(event, eventType.policy.template_key, eventType.key);
  const localeCandidates = localeCandidatesFor(policyUser.locale);
  const templates = await findTemplateForRecipient(db, templateKey, "email", localeCandidates);
  const payloadData = (notification.payload ?? {}) as Record<string, unknown>;
  const campaignChannel =
    eventType.key === "campaign.message" && typeof payloadData.campaign_channel === "string"
      ? (payloadData.campaign_channel as Channel)
      : null;
  const candidateChannels = campaignChannel
    ? policy.allowedChannels.filter((channel) => channel === campaignChannel)
    : policy.allowedChannels;

  const selected: Array<{
    channel: Channel;
    provider: string;
    templateVersionId: string | null;
  }> = [];

  const decisions: Array<{ channel: Channel; allowed: boolean; reason: string }> = [
    ...policy.channels,
  ];

  if (candidateChannels.length === 0) {
    await markTerminal(db, notification.id, notification.traceId, "failed", {
      policy_hash: policy.policyHash,
      channels: policy.channels,
      reason: "campaign_channel_unavailable",
    });

    return {
      notificationId: notification.id,
      status: "failed",
      channels: [],
      duplicate: false,
    };
  }

  for (const channel of candidateChannels) {
    const channelTemplates =
      channel === "email"
        ? templates
        : await findTemplateForRecipient(db, templateKey, channel, localeCandidates);
    const template = selectLocalized(channelTemplates, policyUser.locale);

    if (!template?.currentVersion) {
      decisions.push({ channel, allowed: false, reason: "template_missing" });
      continue;
    }

    selected.push({
      channel,
      provider: PROVIDERS[channel],
      templateVersionId: template.currentVersion.id,
    });
  }

  if (selected.length === 0) {
    await markTerminal(db, notification.id, notification.traceId, "failed", {
      policy_hash: policy.policyHash,
      channels: decisions,
      reason: "no_template",
    });

    return {
      notificationId: notification.id,
      status: "failed",
      channels: [],
      duplicate: false,
    };
  }

  const transition = transitionNotification(currentStatus, "processing");

  if (!transition.ok) {
    throw new AppError("internal_error", "Notification cannot enter processing", 500, {
      details: { from: currentStatus },
    });
  }

  const deliveryTopics = selected.map((item) => ({
    ...item,
    topic: `herald.deliveries.${priority}.v1`,
  }));

  await db.$transaction(async (tx) => {
    const raced = await tx.fanoutPlan.findUnique({ where: { notificationId: notification.id } });

    if (raced) {
      return;
    }

    await tx.notification.update({
      where: { id: notification.id },
      data: {
        status: notificationStatusToDb("processing"),
        priority: priorityToDb(priority),
      },
    });

    await tx.fanoutPlan.create({
      data: {
        id: newId(),
        notificationId: notification.id,
        policyHash: policy.policyHash,
        policySnapshot: policy.snapshot as Prisma.InputJsonValue,
        channels: decisions as unknown as Prisma.InputJsonValue,
      },
    });

    const deliveries = deliveryTopics.map((item) => ({
      id: newId(),
      notificationId: notification.id,
      userId: notification.userId,
      channel: channelToDb(item.channel),
      priority: priorityToDb(priority),
      provider: item.provider,
      templateVersionId: item.templateVersionId,
    }));

    await tx.delivery.createMany({ data: deliveries });

    await tx.outbox.createMany({
      data: deliveries.map((delivery, index) => {
        const item = deliveryTopics[index]!;
        const message: DeliveryMessage = {
          delivery_id: delivery.id,
          notification_id: notification.id,
          user_id: notification.userId,
          channel: item.channel,
          priority,
          source: sourceFromDb(notification.source),
          trace_id: notification.traceId,
          shard: event.shard,
        };

        return {
          id: newId(),
          aggregateType: "delivery",
          aggregateId: delivery.id,
          shard: event.shard,
          topic: item.topic,
          partitionKey: notification.userId,
          payload: message as unknown as Prisma.InputJsonValue,
          headers: {
            trace_id: notification.traceId,
            notification_id: notification.id,
            delivery_id: delivery.id,
            priority,
            source: sourceFromDb(notification.source),
            schema_version: notification.eventVersion,
            shard: event.shard,
          },
        };
      }),
    });

    await tx.notificationEvent.create({
      data: {
        id: newId(),
        notificationId: notification.id,
        kind: "fanout_planned",
        actor: "orchestrator",
        data: {
          policy_hash: policy.policyHash,
          priority,
          channels: selected.map((item) => item.channel),
        },
      },
    });

    if (notification.eventType === "campaign.message") {
      await syncRecipientStatus(tx, notification.id, "processing");
    }
  });

  return {
    notificationId: notification.id,
    status: "processing",
    channels: selected.map((item) => item.channel),
    duplicate: false,
  };
};

const resolvePolicy = (
  eventType: EventTypeDefinition,
  priority: EventEnvelope["priority"],
  policyUser: PolicyUser,
  availability: ChannelAvailability,
  usage: Partial<Record<Channel, number>>,
  now: Date,
): FanoutPolicyResult =>
  resolveFanoutPolicy({
    eventType,
    priority,
    user: policyUser,
    availability,
    usage,
    now,
  });

const markTerminal = async (
  db: Db,
  notificationId: string,
  traceId: string,
  status: "failed" | "suppressed",
  detail: Record<string, unknown>,
): Promise<void> => {
  await db.$transaction(async (tx) => {
    await tx.notification.update({
      where: { id: notificationId },
      data: { status: notificationStatusToDb(status) },
    });

    await tx.notificationEvent.create({
      data: {
        id: newId(),
        notificationId,
        kind: status,
        actor: "orchestrator",
        data: { trace_id: traceId, ...detail },
      },
    });

    await syncRecipientStatus(tx, notificationId, status);
  });
};

const scheduleNotification = async (
  db: Db,
  notificationId: string,
  traceId: string,
  policy: FanoutPolicyResult,
): Promise<void> => {
  const scheduledFor = policy.deferredUntil ?? new Date();

  await db.$transaction(async (tx) => {
    await tx.notification.update({
      where: { id: notificationId },
      data: {
        status: notificationStatusToDb("scheduled"),
        scheduledFor,
        policySnapshot: policy.snapshot as Prisma.InputJsonValue,
      },
    });

    await tx.notificationEvent.create({
      data: {
        id: newId(),
        notificationId,
        kind: "deferred",
        actor: "orchestrator",
        data: {
          trace_id: traceId,
          scheduled_for: scheduledFor.toISOString(),
          policy_hash: policy.policyHash,
          channels: policy.channels as unknown as Prisma.InputJsonValue,
        },
      },
    });

    await syncRecipientStatus(tx, notificationId, "scheduled");
  });
};
