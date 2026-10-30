import type { Priority } from "@herald/contracts";

export type TopicName =
  | `herald.events.${Priority}.v1`
  | `herald.deliveries.${Priority}.v1`
  | "herald.webhooks.v1"
  | "herald.dlq.v1";

export const TOPIC_RETENTION_MS = {
  events: 24 * 60 * 60 * 1000,
  deliveries: 24 * 60 * 60 * 1000,
  webhooks: 24 * 60 * 60 * 1000,
  dlq: 7 * 24 * 60 * 60 * 1000,
} as const;

export const eventsTopic = (priority: Priority): TopicName => `herald.events.${priority}.v1`;
export const deliveriesTopic = (priority: Priority): TopicName =>
  `herald.deliveries.${priority}.v1`;

export const ALL_TOPICS: TopicName[] = [
  eventsTopic("critical"),
  eventsTopic("high"),
  eventsTopic("normal"),
  eventsTopic("low"),
  deliveriesTopic("critical"),
  deliveriesTopic("high"),
  deliveriesTopic("normal"),
  deliveriesTopic("low"),
  "herald.webhooks.v1",
  "herald.dlq.v1",
];

export const EVENT_TOPICS = ALL_TOPICS.filter((topic) => topic.startsWith("herald.events."));
export const DELIVERY_TOPICS = ALL_TOPICS.filter((topic) => topic.startsWith("herald.deliveries."));

export const consumerGroup = (
  role: "orchestrator" | "delivery" | "webhook",
  priority?: Priority,
): string =>
  priority ? `herald-${role}-${priority}` : `herald-${role}`;

export const topicRetention = (topic: TopicName): number => {
  if (topic === "herald.dlq.v1") {
    return TOPIC_RETENTION_MS.dlq;
  }

  if (topic === "herald.webhooks.v1") {
    return TOPIC_RETENTION_MS.webhooks;
  }

  return topic.startsWith("herald.events.") ? TOPIC_RETENTION_MS.events : TOPIC_RETENTION_MS.deliveries;
};
