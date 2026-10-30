import type { EventTypeDefinition } from "./event";

export const EVENT_CATALOG: readonly EventTypeDefinition[] = [
  {
    key: "booking.confirmed",
    schema_version: 1,
    default_priority: "normal",
    allowed_channels: ["email", "in_app", "push"],
    allowed_sources: ["booking"],
    dedupe_window_seconds: 86_400,
    policy: {
      category: "booking",
      quiet_hours_bypass: false,
      allow_priority_override: false,
      marketing: false,
      caps: { email: 5, in_app: 40, push: 20 },
      cap_action: "defer",
    },
  },
  {
    key: "booking.canceled",
    schema_version: 1,
    default_priority: "high",
    allowed_channels: ["email", "in_app", "push"],
    allowed_sources: ["booking"],
    dedupe_window_seconds: 86_400,
    policy: {
      category: "booking",
      quiet_hours_bypass: false,
      allow_priority_override: false,
      marketing: false,
      caps: { email: 5, in_app: 40, push: 20 },
      cap_action: "defer",
    },
  },
  {
    key: "payment.failed",
    schema_version: 1,
    default_priority: "high",
    allowed_channels: ["email", "in_app"],
    allowed_sources: ["payments"],
    dedupe_window_seconds: 3_600,
    policy: {
      category: "billing",
      quiet_hours_bypass: false,
      allow_priority_override: false,
      marketing: false,
      caps: { email: 3, in_app: 20 },
      cap_action: "defer",
    },
  },
  {
    key: "security.alert",
    schema_version: 1,
    default_priority: "critical",
    allowed_channels: ["email", "in_app", "push"],
    allowed_sources: ["security"],
    dedupe_window_seconds: 300,
    policy: {
      category: "security",
      quiet_hours_bypass: true,
      allow_priority_override: false,
      marketing: false,
      caps: { email: 20, in_app: 100, push: 50 },
      cap_action: "suppress",
    },
  },
  {
    key: "campaign.message",
    schema_version: 1,
    default_priority: "low",
    allowed_channels: ["email", "in_app", "push"],
    allowed_sources: ["growth"],
    dedupe_window_seconds: 2_592_000,
    policy: {
      category: "marketing",
      quiet_hours_bypass: false,
      allow_priority_override: false,
      marketing: true,
      caps: { email: 1, in_app: 3, push: 2 },
      cap_action: "suppress",
    },
  },
];

export const EVENT_TYPE_KEYS = EVENT_CATALOG.map((eventType) => eventType.key);

export const getEventTypeDefinition = (key: string): EventTypeDefinition | undefined =>
  EVENT_CATALOG.find((eventType) => eventType.key === key);
