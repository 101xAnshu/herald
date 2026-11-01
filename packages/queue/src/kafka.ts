import {
  Kafka,
  logLevel,
  type Admin,
  type Consumer,
  type EachMessagePayload,
  type Producer,
} from "kafkajs";

import { loadConfig } from "@herald/config";
import type {
  MessageHeaders,
  QueueBatchMessage,
  QueueConsumer,
  QueueConsumerMessage,
  QueuePublisher,
} from "@herald/core";
import { ALL_TOPICS, topicRetention } from "./topics";

const createKafka = (clientId: string): Kafka => {
  const config = loadConfig();

  return new Kafka({
    clientId,
    brokers: [...config.kafkaBrokers],
    logLevel: logLevel.WARN,
    retry: { initialRetryTime: 200, retries: 8 },
  });
};

const encodeHeaders = (headers?: MessageHeaders): Record<string, string> => {
  if (!headers) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]),
  );
};

const decodeHeaders = (headers: EachMessagePayload["message"]["headers"]): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers ?? {}).map(([key, value]) => [
      key,
      value === undefined ? "" : Buffer.isBuffer(value) ? value.toString("utf8") : String(value),
    ]),
  );

class KafkaPublisher implements QueuePublisher {
  private producer: Producer | null = null;

  async connect(): Promise<void> {
    if (this.producer) {
      return;
    }

    const producer = createKafka("herald-producer").producer({
      idempotent: true,
      maxInFlightRequests: 5,
      allowAutoTopicCreation: false,
    });

    await producer.connect();
    this.producer = producer;
  }

  async publish(
    topic: string,
    key: string,
    payload: unknown,
    headers?: MessageHeaders,
  ): Promise<void> {
    await this.connect();

    await this.producer!.send({
      topic,
      acks: -1,
      messages: [
        {
          key,
          value: JSON.stringify(payload),
          headers: encodeHeaders({ ...headers, schema_version: headers?.schema_version ?? 1 }),
        },
      ],
    });
  }

  async publishMany(
    topic: string,
    messages: readonly QueueBatchMessage[],
  ): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    await this.connect();

    await this.producer!.send({
      topic,
      acks: -1,
      messages: messages.map((message) => ({
        key: message.key,
        value: JSON.stringify(message.payload),
        headers: encodeHeaders({
          ...message.headers,
          schema_version: message.headers?.schema_version ?? 1,
        }),
      })),
    });
  }

  async disconnect(): Promise<void> {
    await this.producer?.disconnect();
    this.producer = null;
  }
}

export const createPublisher = (): QueuePublisher => new KafkaPublisher();

export interface ConsumerOptions {
  groupId: string;
  topics: string[];
  handler: (message: QueueConsumerMessage) => Promise<void>;
  partitionsConsumedConcurrently?: number;
}

export class KafkaConsumer implements QueueConsumer {
  private readonly consumer: Consumer;
  private readonly topics: string[];
  private readonly handler: (message: QueueConsumerMessage) => Promise<void>;
  private readonly partitionsConsumedConcurrently: number;

  constructor(options: ConsumerOptions) {
    this.consumer = createKafka("herald-worker").consumer({
      groupId: options.groupId,
      sessionTimeout: 30_000,
      heartbeatInterval: 3_000,
      maxWaitTimeInMs: 1_000,
    });
    this.topics = options.topics;
    this.handler = options.handler;
    this.partitionsConsumedConcurrently = options.partitionsConsumedConcurrently ?? 1;
  }

  async subscribe(): Promise<void> {
    await this.consumer.connect();

    for (const topic of this.topics) {
      await this.consumer.subscribe({ topic, fromBeginning: false });
    }

    await this.consumer.run({
      autoCommit: true,
      autoCommitInterval: 1_000,
      partitionsConsumedConcurrently: this.partitionsConsumedConcurrently,
      eachMessage: async (payload) => {
        const value = payload.message.value?.toString("utf8");

        await this.handler({
          topic: payload.topic,
          partition: payload.partition,
          offset: payload.message.offset,
          key: payload.message.key?.toString("utf8") ?? null,
          value: value ? (JSON.parse(value) as unknown) : null,
          headers: decodeHeaders(payload.message.headers),
        });
      },
    });
  }

  async pause(topic?: string): Promise<void> {
    await this.consumer.pause(topic ? [{ topic }] : this.topics.map((name) => ({ topic: name })));
  }

  async resume(topic?: string): Promise<void> {
    await this.consumer.resume(topic ? [{ topic }] : this.topics.map((name) => ({ topic: name })));
  }

  async disconnect(): Promise<void> {
    await this.consumer.disconnect();
  }
}

export const ensureTopics = async (partitions = 6): Promise<void> => {
  const admin: Admin = createKafka("herald-admin").admin();
  await admin.connect();

  try {
    try {
      await admin.createTopics({
        waitForLeaders: true,
        topics: ALL_TOPICS.map((topic) => ({
          topic,
          numPartitions: partitions,
          replicationFactor: 1,
          configEntries: [{ name: "retention.ms", value: String(topicRetention(topic)) }],
        })),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const ignorable =
        message.includes("Topic with this name already exists") ||
        ("type" in Object(error) && (error as { type?: string }).type === "TOPIC_ALREADY_EXISTS");

      if (!ignorable) {
        throw error;
      }
    }

    const metadata = await admin.fetchTopicMetadata({ topics: ALL_TOPICS });
    const short = metadata.topics.filter(
      (topic) => (ALL_TOPICS as readonly string[]).includes(topic.name) && topic.partitions.length < partitions,
    );

    if (short.length > 0) {
      await admin.createPartitions({
        topicPartitions: short.map((topic) => ({ topic: topic.name, count: partitions })),
      });
    }
  } finally {
    await admin.disconnect();
  }
};

export const checkKafka = async (): Promise<boolean> => {
  const admin = createKafka("herald-health").admin();
  await admin.connect();

  try {
    await admin.describeCluster();
    return true;
  } catch {
    return false;
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
};

export { ALL_TOPICS, EVENT_TOPICS, DELIVERY_TOPICS } from "./topics";
export { consumerGroup, deliveriesTopic, eventsTopic, topicRetention } from "./topics";
