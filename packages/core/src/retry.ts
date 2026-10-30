import type { Channel } from "@herald/contracts";

export const RETRY_BASE_MS = 30_000;
export const RETRY_CAP_MS = 30 * 60_000;

export const MAX_ATTEMPTS: Record<Channel, number> = {
  email: 5,
  in_app: 5,
  push: 5,
  sms: 3,
};

export const maxAttemptsForChannel = (channel: Channel): number => MAX_ATTEMPTS[channel];

export const retryDelayMs = (attempt: number, random: () => number = Math.random): number => {
  if (attempt < 1) {
    throw new RangeError("attempt must be at least 1");
  }

  const ceiling = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** (attempt - 1));
  return Math.floor(random() * ceiling);
};

export const canRetry = (channel: Channel, attemptsMade: number): boolean =>
  attemptsMade < maxAttemptsForChannel(channel);
