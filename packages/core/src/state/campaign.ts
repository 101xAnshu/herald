import type { CampaignRecipientStatus, CampaignStatus } from "@herald/contracts";

import { applyTransition, type TransitionResult } from "./transition";

const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ["scheduled", "running", "canceled"],
  scheduled: ["running", "canceled", "failed"],
  running: ["paused", "completed", "canceled", "failed"],
  paused: ["running", "canceled", "failed"],
  completed: [],
  canceled: [],
  failed: [],
};

const RECIPIENT_TRANSITIONS: Record<
  CampaignRecipientStatus,
  readonly CampaignRecipientStatus[]
> = {
  pending: ["queued", "canceled", "suppressed"],
  queued: ["sent", "failed", "suppressed", "canceled"],
  sent: ["delivered", "failed"],
  delivered: [],
  failed: [],
  suppressed: [],
  canceled: [],
};

export const transitionCampaign = (
  current: CampaignStatus,
  next: CampaignStatus,
): TransitionResult<CampaignStatus> => applyTransition(CAMPAIGN_TRANSITIONS, current, next);

export const transitionCampaignRecipient = (
  current: CampaignRecipientStatus,
  next: CampaignRecipientStatus,
): TransitionResult<CampaignRecipientStatus> =>
  applyTransition(RECIPIENT_TRANSITIONS, current, next);

export const isCampaignTerminal = (status: CampaignStatus): boolean =>
  status === "completed" || status === "canceled" || status === "failed";
