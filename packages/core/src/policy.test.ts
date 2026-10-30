import { describe, expect, it } from "vitest";

import type { Channel, EventTypeDefinition, Priority } from "@herald/contracts";

import { resolveFanoutPolicy, type ChannelAvailability, type PolicyUser } from "./policy";

const now = new Date("2026-10-30T10:00:00Z");

const availability: ChannelAvailability = {
  email: true,
  in_app: true,
  push: true,
  sms: true,
};

const user = (overrides: Partial<PolicyUser> = {}): PolicyUser => ({
  id: "user-1",
  kind: "customer",
  status: "active",
  locale: "en-IN",
  timezone: "Asia/Kolkata",
  email: "user@example.test",
  phone: "+919000000000",
  preferences: [],
  quietStart: null,
  quietEnd: null,
  marketingPaused: false,
  activeDeviceChannels: ["push"],
  suppressedChannels: [],
  ...overrides,
});

const eventType = (overrides: Partial<EventTypeDefinition> = {}): EventTypeDefinition => ({
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
  ...overrides,
});

const resolve = (
  type: EventTypeDefinition,
  priority: Priority,
  policyUser: PolicyUser,
  usage: Partial<Record<Channel, number>> = {},
) =>
  resolveFanoutPolicy({
    eventType: type,
    priority,
    user: policyUser,
    availability,
    usage,
    now,
  });

describe("fanout policy", () => {
  it("allows every permitted channel by default", () => {
    const result = resolve(eventType(), "normal", user());

    expect(result.outcome).toBe("process");
    expect(result.allowedChannels).toEqual(["email", "in_app", "push"]);
    expect(result.policyHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("honors an explicit opt-out", () => {
    const result = resolve(
      eventType(),
      "normal",
      user({ preferences: [{ category: "booking", channel: "email", enabled: false }] }),
    );

    expect(result.allowedChannels).not.toContain("email");
    expect(result.channels.find((channel) => channel.channel === "email")).toMatchObject({
      allowed: false,
      reason: "user_opt_out",
    });
  });

  it("defers non-critical traffic during quiet hours", () => {
    const quietUser = user({ quietStart: "22:00", quietEnd: "07:00" });
    const result = resolveFanoutPolicy({
      eventType: eventType(),
      priority: "normal",
      user: quietUser,
      availability,
      usage: {},
      now: new Date("2026-10-30T18:00:00Z"),
    });

    expect(result.outcome).toBe("scheduled");
    expect(result.allowedChannels).toEqual([]);
    expect(result.deferredUntil?.toISOString()).toBe("2026-10-31T01:30:00.000Z");
  });

  it("lets critical traffic bypass quiet hours and opt-outs", () => {
    const result = resolveFanoutPolicy({
      eventType: eventType({ key: "security.alert" }),
      priority: "critical",
      user: user({
        quietStart: "22:00",
        quietEnd: "07:00",
        preferences: [{ category: "booking", channel: "email", enabled: false }],
      }),
      availability,
      usage: {},
      now: new Date("2026-10-30T18:00:00Z"),
    });

    expect(result.outcome).toBe("process");
    expect(result.allowedChannels).toEqual(["email", "in_app", "push"]);
  });

  it("requires explicit opt-in for marketing", () => {
    const marketingType = eventType({
      key: "campaign.message",
      policy: {
        category: "marketing",
        quiet_hours_bypass: false,
        allow_priority_override: false,
        marketing: true,
        caps: { email: 1 },
        cap_action: "suppress",
      },
    });

    expect(resolve(marketingType, "low", user()).outcome).toBe("suppressed");

    const optedIn = resolve(
      marketingType,
      "low",
      user({
        preferences: [{ category: "marketing", channel: "email", enabled: true }],
      }),
    );

    expect(optedIn.allowedChannels).toEqual(["email"]);
  });

  it("respects a paused marketing setting", () => {
    const result = resolve(
      eventType({
        policy: {
          category: "marketing",
          quiet_hours_bypass: false,
          allow_priority_override: false,
          marketing: true,
          caps: { email: 1 },
          cap_action: "suppress",
        },
      }),
      "low",
      user({
        marketingPaused: true,
        preferences: [{ category: "marketing", channel: "email", enabled: true }],
      }),
    );

    expect(result.outcome).toBe("suppressed");
    expect(result.channels[0]).toMatchObject({ channel: "email", reason: "marketing_paused" });
  });

  it("keeps hard suppression ahead of critical traffic", () => {
    const result = resolve(eventType({ key: "security.alert" }), "critical", user({ suppressedChannels: ["email"] }));

    expect(result.allowedChannels).not.toContain("email");
    expect(result.channels.find((channel) => channel.channel === "email")).toMatchObject({
      reason: "hard_suppression",
    });
  });

  it("defers a capped channel to the next local day", () => {
    const result = resolve(eventType(), "normal", user(), { email: 5 });

    expect(result.allowedChannels).toEqual(["in_app", "push"]);
    expect(result.channels.find((channel) => channel.channel === "email")).toMatchObject({
      reason: "frequency_cap",
    });
  });

  it("suppresses a capped channel when policy says so", () => {
    const result = resolve(
      eventType({
        policy: {
          category: "security",
          quiet_hours_bypass: true,
          allow_priority_override: false,
          marketing: false,
          caps: { email: 1 },
          cap_action: "suppress",
        },
      }),
      "critical",
      user(),
      { email: 1 },
    );

    expect(result.outcome).toBe("process");
    expect(result.allowedChannels).not.toContain("email");
  });

  it("reports a missing push device", () => {
    const result = resolve(eventType(), "normal", user({ activeDeviceChannels: [] }));

    expect(result.channels.find((channel) => channel.channel === "push")).toMatchObject({
      reason: "no_device",
    });
  });

  it("fails when every channel is unavailable", () => {
    const result = resolveFanoutPolicy({
      eventType: eventType(),
      priority: "normal",
      user: user(),
      availability: { email: false, in_app: false, push: false, sms: false },
      usage: {},
      now,
    });

    expect(result.outcome).toBe("failed");
    expect(result.channels.every((channel) => channel.reason === "provider_unavailable")).toBe(true);
  });

  it("applies source policy before user preferences", () => {
    const result = resolveFanoutPolicy({
      eventType: eventType(),
      priority: "normal",
      user: user(),
      availability,
      sourcePolicy: { allowedChannels: ["in_app"] },
      usage: {},
      now,
    });

    expect(result.allowedChannels).toEqual(["in_app"]);
  });
});
