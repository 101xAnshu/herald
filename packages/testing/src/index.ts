import type { IngestEvent } from "@herald/contracts";
import type { PolicyUser } from "@herald/core";

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
