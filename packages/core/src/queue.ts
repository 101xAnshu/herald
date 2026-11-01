export type MessageHeaders = Record<string, string | number | boolean | null | undefined>;

export interface QueueBatchMessage {
  key: string;
  payload: unknown;
  headers?: MessageHeaders;
}

export interface QueuePublisher {
  publish(topic: string, key: string, payload: unknown, headers?: MessageHeaders): Promise<void>;
  publishMany?(topic: string, messages: readonly QueueBatchMessage[]): Promise<void>;
  disconnect(): Promise<void>;
}

export interface QueueConsumerMessage {
  topic: string;
  partition: number;
  offset: string;
  key: string | null;
  value: unknown;
  headers: Record<string, string>;
}

export interface QueueConsumer {
  subscribe(topic: string, handler: (message: QueueConsumerMessage) => Promise<void>): Promise<void>;
  disconnect(): Promise<void>;
}
