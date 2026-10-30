import type { Channel, DeliveryMessage, Priority } from "@herald/contracts";
import { DeliveryMessageSchema } from "@herald/contracts";
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
import { getPrisma } from "@herald/db";

import { redis } from "../redis";

const TOKENS_PER_SECOND = 200;
const BUCKET_CAPACITY = 400;

const takeToken = async (channel: Channel): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await redis().takeToken(
      `tokenbucket:provider:${channel}`,
      BUCKET_CAPACITY,
      TOKENS_PER_SECOND,
    );

    if (result.allowed) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
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

          if (outcome.inboxItemId) {
            const item = await getPrisma(delivery.shard).inboxItem.findUnique({
              where: { id: outcome.inboxItemId },
            });

            if (item) {
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
          }

          logger.info(
            {
              trace_id: delivery.trace_id,
              notification_id: delivery.notification_id,
              delivery_id: delivery.delivery_id,
              channel: delivery.channel,
              status: outcome.status,
              duration_s: duration,
            },
            "delivery processed",
          );
        } catch (error) {
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
