import type { ChannelAdapter, ProviderSendResult } from "@herald/core";

export class MockAdapter implements ChannelAdapter {
  readonly name: string;
  readonly channel: ChannelAdapter["channel"];

  constructor(name: string, channel: ChannelAdapter["channel"]) {
    this.name = name;
    this.channel = channel;
  }

  idempotencyKey(deliveryId: string): string {
    return `herald:${deliveryId}`;
  }

  classify(failure: { status?: number; code?: string; bodyWritten?: boolean }) {
    if (failure.code === "mock_permanent") {
      return "permanent" as const;
    }

    if (failure.code === "mock_rate_limit") {
      return "rate_limit" as const;
    }

    return failure.bodyWritten && failure.code === "timeout_after_body"
      ? ("unknown" as const)
      : ("transient" as const);
  }

  async send(message: Parameters<ChannelAdapter["send"]>[0]): Promise<ProviderSendResult> {
    if (this.channel === "push" && !message.recipient.pushTokenHash) {
      return {
        ok: false,
        error: { class: "invalid_recipient", code: "invalid_token", message: "No active device" },
      };
    }

    switch (message.mockOutcome) {
      case "fail":
        return {
          ok: false,
          error: { class: "permanent", code: "mock_permanent", message: "Mock provider rejected the message" },
        };
      case "timeout":
        return {
          ok: false,
          error: {
            class: "unknown",
            code: "timeout_after_body",
            message: "Mock provider timed out after reading the request",
          },
        };
      case "rate_limit":
        return {
          ok: false,
          error: {
            class: "rate_limit",
            code: "mock_rate_limit",
            message: "Mock provider quota exhausted",
            retryAfterSeconds: 5,
          },
        };
      default:
        return {
          ok: true,
          providerMessageId: `${this.name}_${message.deliveryId.slice(0, 12)}`,
          response: { accepted: true, channel: this.channel },
        };
    }
  }
}
