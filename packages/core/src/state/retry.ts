import type { RetryState } from "@herald/contracts";

import { applyTransition, type TransitionResult } from "./transition";

const RETRY_TRANSITIONS: Record<RetryState, readonly RetryState[]> = {
  pending: ["claimed", "canceled"],
  claimed: ["succeeded", "exhausted", "canceled"],
  succeeded: [],
  exhausted: [],
  canceled: [],
};

export const transitionRetry = (
  current: RetryState,
  next: RetryState,
): TransitionResult<RetryState> => applyTransition(RETRY_TRANSITIONS, current, next);
