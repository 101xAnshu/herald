import { describe, expect, it } from "vitest";

import { makePolicyUser } from "@herald/testing";

import { MockAdapter } from "./mock";

const message = {
  deliveryId: "delivery-1",
  notificationId: "notification-1",
  userId: "user-1",
  channel: "push" as const,
  priority: "normal" as const,
  source: "booking" as const,
  traceId: "trace-1",
  idempotencyKey: "herald:delivery-1",
  subject: "Hello",
  html: "<p>Hello</p>",
  text: "Hello",
  recipient: { email: null, phone: null, pushTokenHash: "token" },
  metadata: {},
};

describe("mock adapter", () => {
  const adapter = new MockAdapter("mock_push", "push");

  it("accepts by default", async () => {
    const result = await adapter.send(message);
    expect(result).toMatchObject({ ok: true });
    expect(result.providerMessageId).toContain("mock_push_");
  });

  it("returns deterministic failures", async () => {
    await expect(adapter.send({ ...message, mockOutcome: "fail" })).resolves.toMatchObject({
      ok: false,
      error: { class: "permanent" },
    });
    await expect(adapter.send({ ...message, mockOutcome: "timeout" })).resolves.toMatchObject({
      ok: false,
      error: { class: "unknown" },
    });
    await expect(adapter.send({ ...message, mockOutcome: "rate_limit" })).resolves.toMatchObject({
      ok: false,
      error: { class: "rate_limit" },
    });
  });

  it("rejects a push without a device token", async () => {
    await expect(
      adapter.send({ ...message, recipient: { email: null, phone: null, pushTokenHash: null } }),
    ).resolves.toMatchObject({ ok: false, error: { class: "invalid_recipient" } });
  });

  it("keeps a stable idempotency key", () => {
    expect(adapter.idempotencyKey("delivery-1")).toBe("herald:delivery-1");
  });
});

describe("policy fixture", () => {
  it("provides a usable default user", () => {
    expect(makePolicyUser().status).toBe("active");
  });
});
