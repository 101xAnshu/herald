import type { Channel, ErrorClass, Priority, Source } from "@herald/contracts";

export interface OutboundMessage {
  deliveryId: string;
  notificationId: string;
  userId: string;
  channel: Channel;
  priority: Priority;
  source: Source;
  traceId: string;
  idempotencyKey: string;
  subject: string | null;
  html: string | null;
  text: string;
  recipient: {
    email: string | null;
    phone: string | null;
    pushTokenHash: string | null;
  };
  mockOutcome?: "accept" | "fail" | "timeout" | "rate_limit";
  metadata: Record<string, unknown>;
}

export interface ProviderError {
  class: ErrorClass;
  code?: string;
  message?: string;
  retryAfterSeconds?: number;
}

export interface ProviderSendResult {
  ok: boolean;
  providerMessageId?: string;
  response?: Record<string, unknown>;
  error?: ProviderError;
}

export interface ChannelAdapter {
  readonly name: string;
  readonly channel: Channel;
  send(message: OutboundMessage): Promise<ProviderSendResult>;
  classify(failure: { status?: number; code?: string; bodyWritten?: boolean }): ErrorClass;
  idempotencyKey(deliveryId: string): string;
}

export interface ProviderStatusResult {
  state: "accepted" | "delivered" | "failed" | "unknown";
  errorClass?: ErrorClass;
  errorCode?: string;
}

export interface ProviderStatusResolver {
  resolve(provider: string, providerMessageId: string): Promise<ProviderStatusResult>;
}
