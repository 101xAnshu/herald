import type { EventEnvelope } from "@herald/contracts";
import { EventEnvelopeSchema } from "@herald/contracts";
import { dedupeKey } from "@herald/core";
import { orchestrateNotification } from "@herald/db";
import { KafkaConsumer, consumerGroup, eventsTopic } from "@herald/queue";
import {
  dedupeHits,
  fanoutDeliveries,
  logger,
  orchestratorDuration,
} from "@herald/observability";
import type { Priority } from "@herald/contracts";
import { redis } from "../redis";

export const createOrchestratorConsumers = (priorities: Priority[]): KafkaConsumer[] =>
  priorities.map((priority) => {
    const topic = eventsTopic(priority);

    return new KafkaConsumer({
      groupId: consumerGroup("orchestrator", priority),
      topics: [topic],
      handler: async (message) => {
        const parsed = EventEnvelopeSchema.safeParse(message.value);

        if (!parsed.success) {
          logger.error({ issues: parsed.error.issues, topic }, "invalid event envelope");
          return;
        }

        const event: EventEnvelope = parsed.data;
        const cacheKey = dedupeKey(event.user_id, event.source, event.idempotency_key);

        if (await redis().hasDedupe(cacheKey).catch(() => false)) {
          dedupeHits.inc({ source: event.source });
          return;
        }

        const started = process.hrtime.bigint();

        try {
          const result = await orchestrateNotification(event);
          orchestratorDuration.observe(
            { priority: event.priority, outcome: result.status },
            Number(process.hrtime.bigint() - started) / 1e9,
          );

          for (const channel of result.channels) {
            fanoutDeliveries.inc({ channel, priority: event.priority, source: event.source });
          }

          if (result.status !== "scheduled") {
            await redis()
              .markDedupe(cacheKey, 86_400)
              .catch(() => undefined);
          }

          logger.info(
            {
              trace_id: event.trace_id,
              notification_id: event.notification_id,
              status: result.status,
              channels: result.channels,
            },
            "orchestrated notification",
          );
        } catch (error) {
          logger.error(
            {
              err: error,
              trace_id: event.trace_id,
              notification_id: event.notification_id,
            },
            "orchestration failed",
          );
          throw error;
        }
      },
    });
  });
