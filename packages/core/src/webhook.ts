import { constantTimeEqual, hmacSha256Hex } from "./hash";

export const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface VerifyWebhookInput {
  secret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
  now?: Date;
  toleranceSeconds?: number;
}

export type WebhookVerification =
  | { ok: true }
  | { ok: false; reason: "malformed" | "stale_timestamp" | "invalid_signature" };

const normalizeSignature = (signature: string): string =>
  signature.startsWith("sha256=") ? signature.slice("sha256=".length) : signature;

export const signWebhookPayload = (secret: string, timestamp: string, rawBody: string): string =>
  `sha256=${hmacSha256Hex(secret, `${timestamp}.${rawBody}`)}`;

export const verifyWebhookSignature = (input: VerifyWebhookInput): WebhookVerification => {
  const { secret, timestamp, rawBody, signature } = input;
  const now = input.now ?? new Date();
  const toleranceSeconds = input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;

  if (!/^\d+$/.test(timestamp) || signature.length === 0) {
    return { ok: false, reason: "malformed" };
  }

  const parsed = Number(timestamp);
  const timestampMs = parsed > 1_000_000_000_000 ? parsed : parsed * 1000;

  if (!Number.isFinite(timestampMs) || Math.abs(now.getTime() - timestampMs) > toleranceSeconds * 1000) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const expected = hmacSha256Hex(secret, `${timestamp}.${rawBody}`);

  if (!constantTimeEqual(expected, normalizeSignature(signature))) {
    return { ok: false, reason: "invalid_signature" };
  }

  return { ok: true };
};
