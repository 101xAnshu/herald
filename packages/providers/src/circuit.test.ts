import { describe, expect, it } from "vitest";

import type { ChannelAdapter } from "@herald/core";

import { CircuitBreakerAdapter } from "./circuit";

const message = {
  deliveryId: "delivery-1",
  notificationId: "notification-1",
  userId: "user-1",
  channel: "push" as const,
  priority: "normal" as const,
  source: "booking" as const,
  traceId: "trace-1",
  idempotencyKey: "herald:delivery-1",
  subject: null,
  html: null,
  text: "hello",
  recipient: { email: null, phone: null, pushTokenHash: "token" },
  metadata: {},
};

describe("circuit breaker", () => {
  it("opens after five transient failures and rejects quickly", async () => {
    let clock = 1_000;
    let calls = 0;
    const inner: ChannelAdapter = {
      name: "flaky",
      channel: "push",
      idempotencyKey: (id) => id,
      classify: () => "transient",
      send: async () => {
        calls += 1;
        return { ok: false, error: { class: "transient", code: "boom" } };
      },
    };
    const breaker = new CircuitBreakerAdapter(inner, { now: () => clock, resetMs: 30_000 });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await breaker.send(message);
    }

    const blocked = await breaker.send(message);
    expect(blocked).toMatchObject({ ok: false, error: { code: "circuit_open" } });
    expect(calls).toBe(5);

    clock += 31_000;
    await breaker.send(message);
    expect(calls).toBe(6);
  });

  it("closes after a successful half-open probe", async () => {
    let clock = 1_000;
    let healthy = false;
    const inner: ChannelAdapter = {
      name: "probe",
      channel: "push",
      idempotencyKey: (id) => id,
      classify: () => "transient",
      send: async () =>
        healthy ? { ok: true, providerMessageId: "p1" } : { ok: false, error: { class: "transient" } },
    };
    const breaker = new CircuitBreakerAdapter(inner, { now: () => clock, threshold: 1, resetMs: 1_000 });

    await breaker.send(message);
    healthy = true;
    clock += 1_001;
    await expect(breaker.send(message)).resolves.toMatchObject({ ok: true });
    await expect(breaker.send(message)).resolves.toMatchObject({ ok: true });
  });
});
