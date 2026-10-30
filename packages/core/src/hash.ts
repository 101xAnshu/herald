import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { stableStringify } from "./canonical";

export const sha256Hex = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

export const hmacSha256Hex = (secret: string, value: string | Buffer): string =>
  createHmac("sha256", secret).update(value).digest("hex");

export const constantTimeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
};

export const requestHash = (payload: unknown): string => sha256Hex(stableStringify(payload));

export const hashAddress = (address: string, pepper: string): string =>
  hmacSha256Hex(pepper, address.trim().toLowerCase());

export const hashToken = (token: string, pepper: string): string => hmacSha256Hex(pepper, token);
