import { WebhookEventSchema } from "@herald/contracts";
import {
  aggregateNotificationStatus,
  AppError,
  newId,
  verifyWebhookSignature,
} from "@herald/core";
import {
  deliveryStatusFromDb,
  getPrisma,
  notificationStatusToDb,
  prisma,
  syncRecipientStatus,
} from "@herald/db";
import { loadConfig } from "@herald/config";

export const handleProviderWebhook = async (input: {
  provider: string;
  rawBody: string;
  timestamp: string;
  signature: string;
  traceId: string;
}) => {
  const config = loadConfig();
  const verification = verifyWebhookSignature({
    secret: config.webhookSecret,
    timestamp: input.timestamp,
    rawBody: input.rawBody,
    signature: input.signature,
  });

  if (!verification.ok) {
    throw new AppError("unauthorized", `Webhook rejected: ${verification.reason}`, 401);
  }

  let json: unknown;

  try {
    json = JSON.parse(input.rawBody);
  } catch {
    throw new AppError("invalid_request", "Webhook body is not valid JSON", 400);
  }

  const event = WebhookEventSchema.safeParse(json);

  if (!event.success) {
    throw new AppError("validation_failed", "Webhook payload is invalid", 422, {
      errors: event.error.issues.map((issue) => ({
        field: issue.path.map(String).join(".") || "_",
        code: issue.code,
        message: issue.message,
      })),
    });
  }

  const existing = await prisma.providerEvent.findUnique({
    where: { provider_eventId: { provider: input.provider, eventId: event.data.event_id } },
  });

  if (existing) {
    return { duplicate: true, applied: false, delivery_id: existing.deliveryId };
  }

  let found:
    | { shard: number; delivery: { id: string; notificationId: string; status: string } }
    | undefined;
  const shardCount = config.shardCount;

  for (let shard = 0; shard < shardCount && !found; shard += 1) {
    const db = getPrisma(shard);
    const delivery = event.data.delivery_id
      ? await db.delivery.findUnique({
          where: { id: event.data.delivery_id },
          select: { id: true, notificationId: true, status: true },
        })
      : await db.delivery.findFirst({
          where: { providerMessageId: event.data.provider_message_id },
          select: { id: true, notificationId: true, status: true },
        });

    if (delivery) {
      found = { shard, delivery };
    }
  }

  if (!found) {
    throw new AppError("not_found", "Delivery not found for webhook", 404);
  }

  const db = getPrisma(found.shard);
  const terminal = ["DELIVERED", "FAILED", "CANCELED", "SUPPRESSED"].includes(
    found.delivery.status,
  );
  const nextStatus =
    event.data.type === "delivered"
      ? "DELIVERED"
      : event.data.type === "failed" || event.data.type === "bounced"
        ? "FAILED"
        : null;

  await db.$transaction(async (tx) => {
    await tx.providerEvent.create({
      data: {
        id: newId(),
        provider: input.provider,
        eventId: event.data.event_id,
        deliveryId: found!.delivery.id,
        type: event.data.type,
        payload: event.data as never,
        signatureValid: true,
      },
    });

    if (!nextStatus || terminal) {
      await tx.notificationEvent.create({
        data: {
          id: newId(),
          notificationId: found!.delivery.notificationId,
          kind: terminal ? "webhook_late" : "webhook_ignored",
          actor: `provider:${input.provider}`,
          data: { type: event.data.type, event_id: event.data.event_id, trace_id: input.traceId },
        },
      });
      return;
    }

    await tx.delivery.update({
      where: { id: found!.delivery.id },
      data: {
        status: nextStatus,
        deliveredAt: nextStatus === "DELIVERED" ? new Date() : null,
        failedAt: nextStatus === "FAILED" ? new Date() : null,
      },
    });

    const statuses = await tx.delivery.findMany({
      where: { notificationId: found!.delivery.notificationId },
      select: { status: true },
    });

    const aggregate = aggregateNotificationStatus(
      "processing",
      statuses.map((row) => deliveryStatusFromDb(row.status)),
    );

    await tx.notification.update({
      where: { id: found!.delivery.notificationId },
      data: { status: notificationStatusToDb(aggregate) },
    });

    await tx.notificationEvent.create({
      data: {
        id: newId(),
        notificationId: found!.delivery.notificationId,
        kind: `webhook_${event.data.type}`,
        actor: `provider:${input.provider}`,
        data: { event_id: event.data.event_id, trace_id: input.traceId },
      },
    });

    await syncRecipientStatus(tx, found!.delivery.notificationId, aggregate);
  });

  return {
    duplicate: false,
    applied: Boolean(nextStatus) && !terminal,
    delivery_id: found.delivery.id,
  };
};
