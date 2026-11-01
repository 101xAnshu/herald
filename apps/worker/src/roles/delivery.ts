import type { Channel, DeliveryMessage, Priority } from "@herald/contracts";
import { DeliveryMessageSchema } from "@herald/contracts";
import { loadConfig } from "@herald/config";
import { AppError } from "@herald/core";
import { processDelivery } from "@herald/db";
import type { AdapterRegistry } from "@herald/providers";
import { KafkaConsumer, consumerGroup, deliveriesTopic } from "@herald/queue";
import {
  deliveriesTotal,
  deliveryAttempts,
  deliveryLatency,
  inboxItems,
  logger,
  retriesScheduled,
} from "@herald/observability";

import { redis } from "../redis";

const TOKEN_CHUNK_MAX = 25;

const localTokens = new Map<Channel, number>();

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Provider quota is shared by every delivery process, so the bucket lives in
 * Redis. Each process leases a small chunk of tokens and spends them locally to
 * keep the round trips off the hot path. A process without a token waits; it
 * never sends without one.
 */
const takeToken = async (channel: Channel): Promise<void> => {
  const rate = loadConfig().providerRateLimit;
  const chunk = Math.max(1, Math.min(TOKEN_CHUNK_MAX, Math.floor(rate / 8)));
  const available = localTokens.get(channel) ?? 0;

  if (available > 0) {
    localTokens.set(channel, available - 1);
    return;
  }

  const capacity = Math.max(chunk * 8, rate * 2);

  for (;;) {
    const result = await redis().takeToken(
      `tokenbucket:provider:${channel}`,
      capacity,
      rate,
      chunk,
    );

    if (result.allowed) {
      localTokens.set(channel, chunk - 1);
      return;
    }

    await sleep(Math.max(10, Math.ceil((chunk / rate) * 1_000)));
  }
};

export const createDeliveryConsumers = (
  adapters: AdapterRegistry,
  priorities: Priority[],
): KafkaConsumer[] =>
  priorities.map((priority) => {
    const topic = deliveriesTopic(priority);

    return new KafkaConsumer({
      groupId: consumerGroup("delivery", priority),
      topics: [topic],
      partitionsConsumedConcurrently: loadConfig().consumerConcurrency,
      handler: async (message) => {
        const parsed = DeliveryMessageSchema.safeParse(message.value);

        if (!parsed.success) {
          logger.error({ issues: parsed.error.issues, topic }, "invalid delivery message");
          return;
        }

        const delivery: DeliveryMessage = parsed.data;
        await takeToken(delivery.channel);

        const adapter = adapters.get(delivery.channel);
        const started = process.hrtime.bigint();

        try {
          const outcome = await processDelivery(delivery, adapter);
          const duration = Number(process.hrtime.bigint() - started) / 1e9;

          deliveryLatency.observe({ channel: delivery.channel, stage: "provider" }, duration);
          deliveriesTotal.inc({
            channel: delivery.channel,
            status: outcome.status,
            provider: adapter.name,
          });
          deliveryAttempts.inc({
            channel: delivery.channel,
            provider: adapter.name,
            result: outcome.status,
          });

          if (outcome.retryAt) {
            retriesScheduled.inc({ channel: delivery.channel });
          }

          if (outcome.inbox) {
            const item = outcome.inbox;
            inboxItems.inc({ source: delivery.source });
            await redis().publish(`inbox:events:${delivery.user_id}`, {
              id: item.id,
              notification_id: item.notificationId,
              source: item.source.toLowerCase(),
              title: item.title,
              body: item.body,
              deep_link: item.deepLink,
              read_at: item.readAt?.toISOString() ?? null,
              created_at: item.createdAt.toISOString(),
              expires_at: item.expiresAt?.toISOString() ?? null,
              sequence: item.sequence.toString(),
              metadata: item.metadata,
            });
          }

          const fields = {
            trace_id: delivery.trace_id,
            notification_id: delivery.notification_id,
            delivery_id: delivery.delivery_id,
            channel: delivery.channel,
            status: outcome.status,
            duration_s: duration,
          };

          if (outcome.status === "accepted" || outcome.status === "delivered") {
            logger.debug(fields, "delivery processed");
          } else {
            logger.info(fields, "delivery processed");
          }
        } catch (error) {
          if (error instanceof AppError && error.code === "not_found") {
            logger.warn(
              {
                trace_id: delivery.trace_id,
                delivery_id: delivery.delivery_id,
                channel: delivery.channel,
              },
              "delivery row no longer exists, acknowledging",
            );
            return;
          }

          logger.error(
            {
              err: error,
              trace_id: delivery.trace_id,
              delivery_id: delivery.delivery_id,
              channel: delivery.channel,
            },
            "delivery failed unexpectedly",
          );
          throw error;
        }
      },
    });
  });
