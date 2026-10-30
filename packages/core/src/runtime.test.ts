import { describe, expect, it } from "vitest";

import { classifyProviderError, isRetryableClass } from "./classification";
import { canRetry, retryDelayMs } from "./retry";
import { signWebhookPayload, verifyWebhookSignature } from "./webhook";

describe("error classification", () => {
  it.each([
    [{ status: 400 }, "permanent"],
    [{ status: 422 }, "permanent"],
    [{ status: 500 }, "transient"],
    [{ status: 503 }, "transient"],
    [{ status: 429 }, "rate_limit"],
    [{ status: 401 }, "auth"],
    [{ code: "invalid_recipient" }, "invalid_recipient"],
    [{ code: "suppressed" }, "suppressed"],
    [{ timedOut: true, bodyWritten: true }, "unknown"],
    [{ timedOut: true, bodyWritten: false }, "transient"],
    [{ acceptedWithoutId: true }, "unknown"],
    [{ code: "ECONNRESET", bodyWritten: true }, "unknown"],
  ] as const)("classifies %j as %s", (failure, expected) => {
    expect(classifyProviderError(failure)).toBe(expected);
  });

  it("only retries transient and rate-limit failures", () => {
    expect(isRetryableClass("transient")).toBe(true);
    expect(isRetryableClass("rate_limit")).toBe(true);
    expect(isRetryableClass("unknown")).toBe(false);
    expect(isRetryableClass("permanent")).toBe(false);
  });
});

describe("retry policy", () => {
  it("uses full jitter under an exponential ceiling", () => {
    expect(retryDelayMs(1, () => 0)).toBe(0);
    expect(retryDelayMs(1, () => 0.999)).toBeLessThan(30_000);
    expect(retryDelayMs(6, () => 0.999)).toBeLessThanOrEqual(30 * 60_000);
  });

  it("rejects an invalid attempt", () => {
    expect(() => retryDelayMs(0)).toThrow(RangeError);
  });

  it("gives SMS a smaller attempt budget", () => {
    expect(canRetry("email", 4)).toBe(true);
    expect(canRetry("email", 5)).toBe(false);
    expect(canRetry("sms", 3)).toBe(false);
  });
});

describe("webhook signatures", () => {
  const secret = "test-secret";
  const now = new Date("2026-10-30T10:00:00Z");
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const body = JSON.stringify({ event_id: "evt_1" });

  it("accepts a valid signature", () => {
    const signature = signWebhookPayload(secret, timestamp, body);

    expect(verifyWebhookSignature({ secret, timestamp, rawBody: body, signature, now })).toEqual({
      ok: true,
    });
  });

  it("rejects a tampered body", () => {
    const signature = signWebhookPayload(secret, timestamp, body);

    expect(
      verifyWebhookSignature({
        secret,
        timestamp,
        rawBody: `${body} `,
        signature,
        now,
      }),
    ).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("rejects a stale timestamp", () => {
    const stale = String(Math.floor(now.getTime() / 1000) - 301);
    const signature = signWebhookPayload(secret, stale, body);

    expect(
      verifyWebhookSignature({ secret, timestamp: stale, rawBody: body, signature, now }),
    ).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("rejects a malformed header", () => {
    expect(
      verifyWebhookSignature({
        secret,
        timestamp: "not-a-number",
        rawBody: body,
        signature: "x",
        now,
      }),
    ).toEqual({ ok: false, reason: "malformed" });
  });
});
