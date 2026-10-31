import type { ChannelAdapter, OutboundMessage, ProviderSendResult } from "@herald/core";
import { providerCircuitState } from "@herald/observability";

export interface CircuitOptions {
  threshold?: number;
  resetMs?: number;
  now?: () => number;
}

const TRIPPING_CLASSES = new Set(["transient", "rate_limit", "auth"]);

export class CircuitBreakerAdapter implements ChannelAdapter {
  readonly name: string;
  readonly channel: ChannelAdapter["channel"];
  private readonly inner: ChannelAdapter;
  private readonly threshold: number;
  private readonly resetMs: number;
  private readonly now: () => number;
  private failures = 0;
  private openUntil = 0;
  private state: "closed" | "half-open" | "open" = "closed";

  constructor(inner: ChannelAdapter, options: CircuitOptions = {}) {
    this.inner = inner;
    this.name = inner.name;
    this.channel = inner.channel;
    this.threshold = options.threshold ?? 5;
    this.resetMs = options.resetMs ?? 30_000;
    this.now = options.now ?? Date.now;
    this.publishState();
  }

  idempotencyKey(deliveryId: string): string {
    return this.inner.idempotencyKey(deliveryId);
  }

  classify(failure: { status?: number; code?: string; bodyWritten?: boolean }) {
    return this.inner.classify(failure);
  }

  async send(message: OutboundMessage): Promise<ProviderSendResult> {
    const now = this.now();

    if (this.state === "open") {
      if (now < this.openUntil) {
        return {
          ok: false,
          error: {
            class: "transient",
            code: "circuit_open",
            message: `Provider circuit is open for ${this.name}`,
          },
        };
      }

      this.state = "half-open";
      this.publishState();
    }

    const wasHalfOpen = this.state === "half-open";
    const result = await this.inner.send(message);

    if (result.ok) {
      this.failures = 0;
      this.state = "closed";
      this.publishState();
      return result;
    }

    if (result.error && TRIPPING_CLASSES.has(result.error.class)) {
      this.failures += 1;

      if (wasHalfOpen || this.failures >= this.threshold) {
        this.state = "open";
        this.openUntil = now + this.resetMs;
        this.publishState();
      }
    }

    return result;
  }

  private publishState(): void {
    const value = this.state === "closed" ? 0 : this.state === "half-open" ? 1 : 2;
    providerCircuitState.labels(this.name).set(value);
  }
}
