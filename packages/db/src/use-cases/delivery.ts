import type {
  Channel,
  DeliveryMessage,
  DeliveryStatus,
  ErrorClass,
  NotificationStatus,
  Source,
} from "@herald/contracts";
import {
  aggregateNotificationStatus,
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
import { syncRecipientStatus } from "./campaigns";

export interface DeliveryOutcome {
  deliveryId: string;
  status: ReturnType<typeof deliveryStatusFromDb>;
  notificationStatus: NotificationStatus;
  retryAt: Date | null;
  inboxItemId: string | null;
}

const terminal = new Set(["ACCEPTED", "DELIVERED", "FAILED", "CANCELED", "SUPPRESSED"]);

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
    };
  }

  const claimed = await db.delivery.updateMany({
    where: { id: delivery.id, status: { in: ["PENDING", "RETRY_SCHEDULED"] } },
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
    };
  }

  const attempt = delivery.attemptCount + 1;
  const channel = channelFromDb(delivery.channel);
  const priority = priorityFromDb(delivery.priority);
  const data = (delivery.notification.payload ?? {}) as Record<string, unknown>;
  const pushTokenHashes = delivery.user.devices.map((device) => device.tokenHash);

  const suppressed = await db.suppressionList.findFirst({
    where: {
      channel: delivery.channel,
      addressHash: {
        in: addressHashesFor(
          channel,
          { email: delivery.user.email, phone: delivery.user.phone },
          pushTokenHashes,
          config.apiKeyPepper,
        ),
      },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });

  const now = new Date();

  if (suppressed) {
    return finalize(db, delivery.id, {
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
    return finalize(db, delivery.id, {
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
    return finalize(db, delivery.id, {
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

  const fault = await db.providerFault.findFirst({
    where: { channel: delivery.channel, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  const mockOutcome = fault?.outcome ?? data.mock_outcome;
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

    return finalize(db, delivery.id, {
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
    return finalize(db, delivery.id, {
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
    return finalize(db, delivery.id, {
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

    return finalize(db, delivery.id, {
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

  return finalize(db, delivery.id, {
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
  deliveryId: string,
  input: FinalizeInput,
): Promise<DeliveryOutcome> => {
  const now = new Date();
  const delivery = await db.delivery.findUnique({
    where: { id: deliveryId },
    select: { notificationId: true, userId: true },
  });

  if (!delivery) {
    throw new AppError("not_found", "Delivery not found", 404);
  }

  const inboxId = input.inbox ? newId() : null;
  const config = loadConfig();

  const notificationStatus = await db.$transaction(async (tx) => {
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
      const latest = await tx.notification.findUnique({ where: { id: delivery.notificationId } });
      return latest?.status ?? "FAILED";
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
    }

    if (input.status === "ACCEPTED" || input.status === "DELIVERED") {
      await tx.retrySchedule.updateMany({
        where: { deliveryId },
        data: { state: "SUCCEEDED" },
      });
    }

    if (input.status === "FAILED") {
      await tx.retrySchedule.updateMany({
        where: { deliveryId },
        data: { state: "EXHAUSTED" },
      });
    }

    if (input.inbox && inboxId) {
      await tx.inboxItem.create({
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
    }

    if (input.deadLetter) {
      await tx.deadLetter.create({
        data: {
          id: newId(),
          topic: `herald.deliveries.${input.deadLetter.priority}.v1`,
          deliveryId,
          notificationId: delivery.notificationId,
          payload: input.deadLetter.message as unknown as Prisma.InputJsonValue,
          headers: { trace_id: input.deadLetter.traceId },
          attempts: input.attempt,
          errorClass: errorClassToDb(input.errorClass ?? "transient"),
          errorCode: input.errorCode,
        },
      });
    }

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

    await tx.notificationEvent.create({
      data: {
        id: newId(),
        notificationId: delivery.notificationId,
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

    await syncRecipientStatus(tx, delivery.notificationId, aggregate);

    return notificationStatusToDb(aggregate);
  });

  return {
    deliveryId,
    status: input.status.toLowerCase() as DeliveryStatus,
    notificationStatus: notificationStatusFromDb(notificationStatus),
    retryAt: input.retryAt ?? null,
    inboxItemId: inboxId,
  };
};
