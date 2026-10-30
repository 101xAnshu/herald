import type {
  Channel,
  EventTypeDefinition,
  Priority,
  UserKind,
  UserStatus,
} from "@herald/contracts";

import { stableStringify } from "./canonical";
import { sha256Hex } from "./hash";
import { isQuietHours, nextLocalMidnight, nextQuietHoursEnd } from "./quiet-hours";

export interface PreferenceRecord {
  category: string;
  channel: Channel;
  enabled: boolean;
}

export interface PolicyUser {
  id: string;
  kind: UserKind;
  status: UserStatus;
  locale: string;
  timezone: string;
  email: string | null;
  phone: string | null;
  preferences: readonly PreferenceRecord[];
  quietStart: string | null;
  quietEnd: string | null;
  marketingPaused: boolean;
  activeDeviceChannels: readonly Channel[];
  suppressedChannels: readonly Channel[];
}

export type ChannelAvailability = Record<Channel, boolean>;

export interface SourcePolicy {
  allowedChannels?: readonly Channel[];
  mutedCategories?: readonly string[];
}

export type PolicyReason =
  | "allowed"
  | "not_allowed"
  | "source_policy"
  | "user_disabled"
  | "missing_address"
  | "no_device"
  | "provider_unavailable"
  | "hard_suppression"
  | "user_opt_out"
  | "marketing_paused"
  | "quiet_hours"
  | "frequency_cap";

export interface ChannelDecision {
  channel: Channel;
  allowed: boolean;
  reason: PolicyReason;
}

export type PolicyOutcome = "process" | "scheduled" | "suppressed" | "failed";

export interface FanoutPolicyResult {
  priority: Priority;
  channels: ChannelDecision[];
  allowedChannels: Channel[];
  deferredUntil: Date | null;
  outcome: PolicyOutcome;
  policyHash: string;
  snapshot: Record<string, unknown>;
}

export interface ResolveFanoutPolicyInput {
  eventType: EventTypeDefinition;
  priority: Priority;
  user: PolicyUser;
  availability: ChannelAvailability;
  sourcePolicy?: SourcePolicy;
  usage: Partial<Record<Channel, number>>;
  now: Date;
}

const SUPPRESSION_REASONS: ReadonlySet<PolicyReason> = new Set([
  "hard_suppression",
  "user_opt_out",
  "marketing_paused",
  "user_disabled",
]);

const preferenceFor = (
  user: PolicyUser,
  category: string,
  channel: Channel,
): PreferenceRecord | undefined =>
  user.preferences.find(
    (preference) => preference.category === category && preference.channel === channel,
  );

const contactFor = (user: PolicyUser, channel: Channel): string | null => {
  if (channel === "email") {
    return user.email;
  }

  if (channel === "sms") {
    return user.phone;
  }

  return "available";
};

const later = (left: Date | null, right: Date | null): Date | null => {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return left.getTime() >= right.getTime() ? left : right;
};

export const resolveFanoutPolicy = (input: ResolveFanoutPolicyInput): FanoutPolicyResult => {
  const { eventType, priority, user, availability, sourcePolicy, usage, now } = input;
  const category = eventType.policy.category;
  const critical = priority === "critical";
  const marketing = eventType.policy.marketing;

  const decisions: ChannelDecision[] = [];
  let deferredUntil: Date | null = null;

  for (const channel of eventType.allowed_channels) {
    const deny = (reason: PolicyReason): void => {
      decisions.push({ channel, allowed: false, reason });
    };

    if (sourcePolicy?.mutedCategories?.includes(category)) {
      deny("source_policy");
      continue;
    }

    if (sourcePolicy?.allowedChannels && !sourcePolicy.allowedChannels.includes(channel)) {
      deny("source_policy");
      continue;
    }

    if (user.status !== "active") {
      deny("user_disabled");
      continue;
    }

    if (user.suppressedChannels.includes(channel)) {
      deny("hard_suppression");
      continue;
    }

    if (!contactFor(user, channel)) {
      deny("missing_address");
      continue;
    }

    if (channel === "push" && !user.activeDeviceChannels.includes(channel)) {
      deny("no_device");
      continue;
    }

    if (!availability[channel]) {
      deny("provider_unavailable");
      continue;
    }

    const preference = preferenceFor(user, category, channel);

    if (!critical) {
      if (marketing && user.marketingPaused) {
        deny("marketing_paused");
        continue;
      }

      if (marketing && preference?.enabled !== true) {
        deny("user_opt_out");
        continue;
      }

      if (!marketing && preference?.enabled === false) {
        deny("user_opt_out");
        continue;
      }
    }

    if (
      !critical &&
      !eventType.policy.quiet_hours_bypass &&
      user.quietStart &&
      user.quietEnd &&
      isQuietHours(now, { start: user.quietStart, end: user.quietEnd, timezone: user.timezone })
    ) {
      const until = nextQuietHoursEnd(now, {
        start: user.quietStart,
        end: user.quietEnd,
        timezone: user.timezone,
      });

      deferredUntil = later(deferredUntil, until);
      deny("quiet_hours");
      continue;
    }

    const cap = eventType.policy.caps?.[channel];
    const used = usage[channel] ?? 0;

    if (cap !== undefined && used >= cap) {
      if (eventType.policy.cap_action === "suppress") {
        deny("frequency_cap");
        continue;
      }

      deferredUntil = later(deferredUntil, nextLocalMidnight(now, user.timezone));
      deny("frequency_cap");
      continue;
    }

    decisions.push({ channel, allowed: true, reason: "allowed" });
  }

  const allowedChannels = decisions.filter((decision) => decision.allowed).map((d) => d.channel);

  let outcome: PolicyOutcome;

  if (allowedChannels.length > 0) {
    outcome = "process";
  } else if (deferredUntil) {
    outcome = "scheduled";
  } else if (decisions.every((decision) => SUPPRESSION_REASONS.has(decision.reason))) {
    outcome = "suppressed";
  } else {
    outcome = "failed";
  }

  const snapshot = {
    event_type: eventType.key,
    event_version: eventType.schema_version,
    category,
    priority,
    marketing,
    quiet_hours_bypass: eventType.policy.quiet_hours_bypass,
    now: now.toISOString(),
    user: {
      id: user.id,
      kind: user.kind,
      status: user.status,
      locale: user.locale,
      timezone: user.timezone,
      quiet_start: user.quietStart,
      quiet_end: user.quietEnd,
      marketing_paused: user.marketingPaused,
      suppressed_channels: [...user.suppressedChannels].sort(),
      active_device_channels: [...user.activeDeviceChannels].sort(),
    },
    preferences: [...user.preferences]
      .map((preference) => ({
        category: preference.category,
        channel: preference.channel,
        enabled: preference.enabled,
      }))
      .sort((left, right) =>
        `${left.category}:${left.channel}`.localeCompare(`${right.category}:${right.channel}`),
      ),
    availability,
    usage,
    decisions,
    deferred_until: deferredUntil?.toISOString() ?? null,
    outcome,
  };

  return {
    priority,
    channels: decisions,
    allowedChannels,
    deferredUntil,
    outcome,
    policyHash: sha256Hex(stableStringify(snapshot)),
    snapshot: snapshot as unknown as Record<string, unknown>,
  };
};
