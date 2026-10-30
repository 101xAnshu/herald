import type { EventTypeDefinition, IngestEvent } from "@herald/contracts";
import { EVENT_CATALOG } from "@herald/contracts";
import type { PolicyUser, PreferenceRecord } from "@herald/core";

let counter = 0;

export const uniqueKey = (prefix = "test"): string => {
  counter += 1;
  return `${prefix}:${Date.now()}:${counter}`;
};

export const makeEvent = (overrides: Partial<IngestEvent> = {}): IngestEvent => ({
  type: "booking.confirmed",
  schema_version: 1,
  recipient: { external_id: overrides.recipient?.external_id ?? "cust_00001" },
  idempotency_key: overrides.idempotency_key ?? uniqueKey("booking"),
  data: {
    booking_id: "bkg_test",
    service: "plumbing",
    pro_name: "Ravi",
    scheduled_for: "2026-11-02T10:00:00+05:30",
    address_label: "Home",
    ...(overrides.data ?? {}),
  },
  ...overrides,
});

export const makePolicyUser = (overrides: Partial<PolicyUser> = {}): PolicyUser => ({
  id: "user-1",
  kind: "customer",
  status: "active",
  locale: "en-IN",
  timezone: "Asia/Kolkata",
  email: "user@example.test",
  phone: "+919800000000",
  preferences: [],
  quietStart: null,
  quietEnd: null,
  marketingPaused: false,
  activeDeviceChannels: ["push"],
  suppressedChannels: [],
  ...overrides,
});

export const makePreference = (
  category: string,
  channel: PreferenceRecord["channel"],
  enabled = true,
): PreferenceRecord => ({ category, channel, enabled });

export const eventType = (key: string): EventTypeDefinition => {
  const definition = EVENT_CATALOG.find((candidate) => candidate.key === key);

  if (!definition) {
    throw new Error(`Unknown event type ${key}`);
  }

  return definition;
};

export const waitFor = async (
  predicate: () => Promise<boolean> | boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> => {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const intervalMs = options.intervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Condition not met within ${timeoutMs}ms`);
};

export const isSuccessEnvelope = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "data" in value &&
  "trace_id" in value &&
  typeof (value as { trace_id: unknown }).trace_id === "string";
