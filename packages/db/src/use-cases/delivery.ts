import type {
  Channel,
  DeliveryMessage,
  DeliveryStatus,
  ErrorClass,
  NotificationStatus,
  Source,
} from "@herald/contracts";
import {
  AppError,
  canRetry,
  classifyProviderError,
  hashAddress,
  newId,
  renderTemplate,
  retryDelayMs,
  type ChannelAdapter,
  type OutboundMessage,
} from "@herald/core";
import { loadConfig } from "@herald/config";
import type { Prisma } from "../generated/prisma/client";
import { getPrisma, type Db } from "../prisma";
import {
  channelFromDb,
  channelToDb,
  deliveryStatusFromDb,
  errorClassToDb,
  notificationStatusFromDb,
  notificationStatusToDb,
  priorityFromDb,
  sourceFromDb,
  sourceToDb,
} from "../mappers";
import { loadSuppressionIndex } from "../repositories/suppressions";
import { syncRecipientStatus } from "./campaigns";

export interface InboxEvent {
  id: string;
  notificationId: string;
  source: Source;
  title: string;
  body: string;
  deepLink: string | null;
  readAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
  sequence: bigint;
  metadata: unknown;
}

export interface DeliveryOutcome {
  deliveryId: string;
  status: ReturnType<typeof deliveryStatusFromDb>;
  notificationStatus: NotificationStatus;
  retryAt: Date | null;
  inboxItemId: string | null;
  inbox: InboxEvent | null;
}

const terminal = new Set(["ACCEPTED", "DELIVERED", "FAILED", "CANCELED", "SUPPRESSED"]);

const FAULT_CACHE_MS = 1_000;
const faultCache = new Map<string, { outcome: string | null; expiresAt: number }>();

const activeFaultOutcome = async (db: Db, channel: Channel): Promise<string | null> => {
  const cached = faultCache.get(channel);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.outcome;
  }

  const fault = await db.providerFault.findFirst({
    where: { channel: channelToDb(channel), expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });

  faultCache.set(channel, {
    outcome: fault?.outcome ?? null,
    expiresAt: Date.now() + FAULT_CACHE_MS,
  });

  return fault?.outcome ?? null;
};

const addressHashesFor = (
  channel: Channel,
  user: { email: string | null; phone: string | null },
  pushTokenHashes: readonly string[],
  pepper: string,
): string[] => {
  if (channel === "email" && user.email) {
    return [hashAddress(user.email, pepper)];
  }

  if (channel === "sms" && user.phone) {
    return [hashAddress(user.phone, pepper)];
  }

  if (channel === "push") {
    return [...pushTokenHashes];
  }

  return [];
};

export const processDelivery = async (
  message: DeliveryMessage,
  adapter: ChannelAdapter,
): Promise<DeliveryOutcome> => {
  const config = loadConfig();
  const db = getPrisma(message.shard);
  const delivery = await db.delivery.findUnique({
    where: { id: message.delivery_id },
    include: {
      notification: true,
      templateVersion: true,
      user: { include: { devices: { where: { status: "ACTIVE" } } } },
    },
  });

  if (!delivery) {
    throw new AppError("not_found", "Delivery not found", 404);
  }

  if (terminal.has(delivery.status)) {
    return {
      deliveryId: delivery.id,
      status: deliveryStatusFromDb(delivery.status),
      notificationStatus: notificationStatusFromDb(delivery.notification.status),
      retryAt: null,
      inboxItemId: null,
      inbox: null,
    };
  }

  const staleSending = new Date(Date.now() - 2 * 60_000);
  const claimed = await db.delivery.updateMany({
    where: {
      id: delivery.id,
      OR: [
        { status: { in: ["PENDING", "RETRY_SCHEDULED"] } },
        { status: "SENDING", updatedAt: { lte: staleSending } },
      ],
    },
    data: { status: "SENDING" },
  });

  if (claimed.count === 0) {
    const latest = await db.delivery.findUnique({
      where: { id: delivery.id },
      include: { notification: true },
    });

    return {
      deliveryId: delivery.id,
      status: deliveryStatusFromDb(latest?.status ?? delivery.status),
      notificationStatus: latest
        ? notificationStatusFromDb(latest.notification.status)
        : notificationStatusFromDb(delivery.notification.status),
      retryAt: null,
      inboxItemId: null,
      inbox: null,
    };
  }

  const context = {
    deliveryId: delivery.id,
    notificationId: delivery.notificationId,
    isCampaign: delivery.notification.eventType === "campaign.message",
    currentNotificationStatus: delivery.notification.status,
  };
  const attempt = delivery.attemptCount + 1;
  const channel = channelFromDb(delivery.channel);
  const priority = priorityFromDb(delivery.priority);
  const data = (delivery.notification.payload ?? {}) as Record<string, unknown>;
  const pushTokenHashes = delivery.user.devices.map((device) => device.tokenHash);

  const suppressionIndex = await loadSuppressionIndex(db);
  const suppressed = addressHashesFor(
    channel,
    { email: delivery.user.email, phone: delivery.user.phone },
    pushTokenHashes,
    config.apiKeyPepper,
  )
    .map((hash) => suppressionIndex.get(hash))
    .find((entry) => entry?.channel === channel);

  const now = new Date();

  if (suppressed) {
    return finalize(db, context, {
      status: "SUPPRESSED",
      attempt,
      channel,
      provider: adapter.name,
      result: "suppressed",
      errorClass: "suppressed",
      errorCode: "send_time_suppression",
      response: { reason: suppressed.reason },
      latencyMs: 0,
    });
  }

  if (!delivery.templateVersion) {
    return finalize(db, context, {
      status: "FAILED",
      attempt,
      channel,
      provider: adapter.name,
      result: "failed",
      errorClass: "permanent",
      errorCode: "template_missing",
      response: {},
      latencyMs: 0,
    });
  }

  const rendered = renderTemplate(
    {
      subject: delivery.templateVersion.subject,
      html: delivery.templateVersion.html,
      text: delivery.templateVersion.text,
    },
    {
      ...data,
      display_name: delivery.user.displayName ?? "there",
      notification_id: delivery.notificationId,
      trace_id: delivery.notification.traceId,
    },
  );

  if (!rendered.ok) {
    return finalize(db, context, {
      status: "FAILED",
      attempt,
      channel,
      provider: adapter.name,
      result: "failed",
      errorClass: "permanent",
      errorCode:
        rendered.reason === "missing_variables"
          ? `template_variables_missing:${rendered.missing?.join(",") ?? ""}`
          : `template_too_large:${rendered.field ?? ""}`,
      response: { reason: rendered.reason },
      latencyMs: 0,
    });
  }

  const mockOutcome = (await activeFaultOutcome(db, channel)) ?? data.mock_outcome;
  const outbound: OutboundMessage = {
    deliveryId: delivery.id,
    notificationId: delivery.notificationId,
    userId: delivery.userId,
    channel,
    priority,
    source: sourceFromDb(delivery.notification.source),
    traceId: delivery.notification.traceId,
    idempotencyKey: adapter.idempotencyKey(delivery.id),
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    recipient: {
      email: delivery.user.email,
      phone: delivery.user.phone,
      pushTokenHash: pushTokenHashes[0] ?? null,
    },
    mockOutcome:
      mockOutcome === "accept" || mockOutcome === "fail" || mockOutcome === "timeout" || mockOutcome === "rate_limit"
        ? mockOutcome
        : undefined,
    metadata: data,
  };

  const startedAt = process.hrtime.bigint();
  let result;

  try {
    result = await adapter.send(outbound);
  } catch (error) {
    const failure =
      error instanceof Error && "code" in error
        ? { code: String((error as { code: unknown }).code), bodyWritten: true }
        : { bodyWritten: true };

    result = {
      ok: false,
      error: {
        class: classifyProviderError(failure),
        code: failure.code,
        message: error instanceof Error ? error.message : "provider call failed",
      },
    };
  }

  const latencyMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
  const errorClass: ErrorClass | null = result.ok
    ? null
    : (result.error?.class ?? classifyProviderError({ code: result.error?.code }));

  if (result.ok) {
    const delivered = channel === "in_app";
    const status = delivered ? "DELIVERED" : "ACCEPTED";

    return finalize(db, context, {
      status,
      attempt,
      channel,
      provider: adapter.name,
      result: delivered ? "delivered" : "accepted",
      providerMessageId: result.providerMessageId,
      response: result.response ?? {},
      latencyMs,
      inbox: delivered
        ? {
            title: rendered.subject ?? delivery.notification.eventType,
            body: rendered.text,
            deepLink:
              typeof data.deep_link === "string" && data.deep_link.length > 0 ? data.deep_link : null,
            metadata: data,
            notificationId: delivery.notificationId,
            userId: delivery.userId,
            source: sourceFromDb(delivery.notification.source),
            traceId: delivery.notification.traceId,
          }
        : undefined,
    });
  }

  const failureClass = errorClass ?? "transient";

  if (failureClass === "unknown") {
    return finalize(db, context, {
      status: "UNKNOWN",
      attempt,
      channel,
      provider: adapter.name,
      result: "unknown",
      errorClass: failureClass,
      errorCode: result.error?.code,
      response: result.response ?? {},
      latencyMs,
    });
  }

  if (failureClass === "suppressed") {
    return finalize(db, context, {
      status: "SUPPRESSED",
      attempt,
      channel,
      provider: adapter.name,
      result: "suppressed",
      errorClass: failureClass,
      errorCode: result.error?.code,
      response: result.response ?? {},
      latencyMs,
    });
  }

  const retryable = failureClass === "transient" || failureClass === "rate_limit";

  if (retryable && canRetry(channel, attempt)) {
    const delay = retryDelayMs(attempt);
    const retryAt = new Date(now.getTime() + delay);

    return finalize(db, context, {
      status: "RETRY_SCHEDULED",
      attempt,
      channel,
      provider: adapter.name,
      result: "retry_scheduled",
      errorClass: failureClass,
      errorCode: result.error?.code,
      response: result.response ?? {},
      latencyMs,
      retryAt,
    });
  }

  return finalize(db, context, {
    status: "FAILED",
    attempt,
    channel,
    provider: adapter.name,
    result: "failed",
    errorClass: failureClass,
    errorCode: result.error?.code,
    response: result.response ?? {},
    latencyMs,
    deadLetter: {
      priority,
      traceId: delivery.notification.traceId,
      message,
    },
  });
};

interface FinalizeContext {
  deliveryId: string;
  notificationId: string;
  isCampaign: boolean;
  currentNotificationStatus: Parameters<typeof notificationStatusFromDb>[0];
}

interface FinalizeInput {
  status: "ACCEPTED" | "DELIVERED" | "RETRY_SCHEDULED" | "UNKNOWN" | "FAILED" | "SUPPRESSED";
  attempt: number;
  channel: Channel;
  provider: string;
  result: string;
  errorClass?: ErrorClass;
  errorCode?: string;
  providerMessageId?: string;
  response: Record<string, unknown>;
  latencyMs: number;
  retryAt?: Date;
  inbox?: {
    title: string;
    body: string;
    deepLink: string | null;
    metadata: Record<string, unknown>;
    notificationId: string;
    userId: string;
    source: Source;
    traceId: string;
  };
  deadLetter?: {
    priority: string;
    traceId: string;
    message: DeliveryMessage;
  };
}

const finalize = async (
  db: Db,
  context: FinalizeContext,
  input: FinalizeInput,
): Promise<DeliveryOutcome> => {
  const now = new Date();
  const { deliveryId, notificationId } = context;
  const inboxId = input.inbox ? newId() : null;
  const config = loadConfig();
  const mayHaveSchedule = input.attempt > 1;

  const result = await db.$transaction(async (tx) => {
    const update = await tx.delivery.updateMany({
      where: { id: deliveryId, status: "SENDING" },
      data: {
        status: input.status,
        attemptCount: input.attempt,
        provider: input.provider,
        providerMessageId: input.providerMessageId,
        nextAttemptAt: input.retryAt ?? null,
        acceptedAt: input.status === "ACCEPTED" ? now : undefined,
        deliveredAt: input.status === "DELIVERED" ? now : undefined,
        failedAt: input.status === "FAILED" ? now : undefined,
      },
    });

    if (update.count === 0) {
      const latest = await tx.notification.findUnique({ where: { id: notificationId } });
      return { notificationStatus: latest?.status ?? ("FAILED" as const), inboxItem: null };
    }

    await tx.deliveryAttempt.create({
      data: {
        id: newId(),
        deliveryId,
        attempt: input.attempt,
        provider: input.provider,
        requestId: `${deliveryId}:${input.attempt}`,
        result: input.result,
        errorClass: input.errorClass ? errorClassToDb(input.errorClass) : null,
        errorCode: input.errorCode,
        latencyMs: input.latencyMs,
        response: input.response as Prisma.InputJsonValue,
      },
    });

    if (input.status === "RETRY_SCHEDULED" && input.retryAt) {
      await tx.retrySchedule.upsert({
        where: { deliveryId },
        create: {
          id: newId(),
          deliveryId,
          channel: channelToDb(input.channel),
          dueAt: input.retryAt,
          attempt: input.attempt + 1,
          state: "PENDING",
        },
        update: { dueAt: input.retryAt, attempt: input.attempt + 1, state: "PENDING" },
      });
    } else if (mayHaveSchedule) {
      const state =
        input.status === "ACCEPTED" || input.status === "DELIVERED"
          ? "SUCCEEDED"
          : input.status === "FAILED"
            ? "EXHAUSTED"
            : "CANCELED";

      await tx.retrySchedule.updateMany({
        where: { deliveryId, state: { in: ["PENDING", "CLAIMED"] } },
        data: { state },
      });
    }

    let inboxItem: InboxEvent | null = null;

    if (input.inbox && inboxId) {
      const created = await tx.inboxItem.create({
        data: {
          id: inboxId,
          userId: input.inbox.userId,
          notificationId: input.inbox.notificationId,
          deliveryId,
          source: sourceToDb(input.inbox.source),
          title: input.inbox.title,
          body: input.inbox.body,
          deepLink: input.inbox.deepLink,
          metadata: input.inbox.metadata as Prisma.InputJsonValue,
          expiresAt: new Date(now.getTime() + config.inboxRetentionDays * 86_400_000),
        },
      });

      inboxItem = {
        id: created.id,
        notificationId: created.notificationId,
        source: input.inbox.source,
        title: created.title,
        body: created.body,
        deepLink: created.deepLink,
        readAt: created.readAt,
        createdAt: created.createdAt,
        expiresAt: created.expiresAt,
        sequence: created.sequence,
        metadata: created.metadata,
      };
    }

    if (input.deadLetter) {
      await tx.deadLetter.create({
        data: {
          id: newId(),
          topic: `herald.deliveries.${input.deadLetter.priority}.v1`,
          deliveryId,
          notificationId,
          payload: input.deadLetter.message as unknown as Prisma.InputJsonValue,
          headers: { trace_id: input.deadLetter.traceId },
          attempts: input.attempt,
          errorClass: errorClassToDb(input.errorClass ?? "transient"),
          errorCode: input.errorCode,
        },
      });
    }

    const updated = await tx.$queryRaw<Array<{ status: Parameters<typeof notificationStatusFromDb>[0] }>>`
      WITH agg AS (
        SELECT
          count(*) AS total,
          CASE
            WHEN bool_or(d.status NOT IN ('accepted', 'delivered', 'failed', 'canceled', 'suppressed'))
              THEN CASE
                WHEN bool_or(d.status IN ('accepted', 'delivered')) THEN 'partially_delivered'::notification_status
                ELSE 'processing'::notification_status
              END
            WHEN bool_or(d.status IN ('accepted', 'delivered')) THEN 'delivered'::notification_status
            WHEN bool_and(d.status = 'suppressed') THEN 'suppressed'::notification_status
            ELSE 'failed'::notification_status
          END AS status
        FROM deliveries d
        WHERE d.notification_id = ${notificationId}
      )
      UPDATE notifications n
      SET status = agg.status, updated_at = now()
      FROM agg
      WHERE n.id = ${notificationId}
        AND agg.total > 0
        AND n.status <> agg.status
      RETURNING n.status
    `;

    const aggregateDb = updated[0]?.status ?? context.currentNotificationStatus;
    const aggregate = notificationStatusFromDb(aggregateDb);

    await tx.notificationEvent.create({
      data: {
        id: newId(),
        notificationId,
        kind: `delivery_${input.status.toLowerCase()}`,
        actor: "worker",
        data: {
          delivery_id: deliveryId,
          channel: input.channel,
          attempt: input.attempt,
          error_class: input.errorClass ?? null,
          error_code: input.errorCode ?? null,
          latency_ms: input.latencyMs,
        },
      },
    });

    if (context.isCampaign) {
      await syncRecipientStatus(tx, notificationId, aggregate);
    }

    return { notificationStatus: notificationStatusToDb(aggregate), inboxItem };
  });

  return {
    deliveryId,
    status: input.status.toLowerCase() as DeliveryStatus,
    notificationStatus: notificationStatusFromDb(result.notificationStatus),
    retryAt: input.retryAt ?? null,
    inboxItemId: result.inboxItem?.id ?? null,
    inbox: result.inboxItem,
  };
};
