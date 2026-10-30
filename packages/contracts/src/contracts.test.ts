import { describe, expect, it } from "vitest";

import { EVENT_CATALOG, EVENT_TYPE_KEYS, getEventTypeDefinition } from "./catalog";
import { IngestEventSchema } from "./event";

describe("event catalog", () => {
  it("defines unique event type keys", () => {
    expect(new Set(EVENT_TYPE_KEYS).size).toBe(EVENT_TYPE_KEYS.length);
  });

  it("keeps every definition valid", () => {
    for (const definition of EVENT_CATALOG) {
      expect(definition.allowed_channels.length).toBeGreaterThan(0);
      expect(definition.allowed_sources.length).toBeGreaterThan(0);
      expect(getEventTypeDefinition(definition.key)).toEqual(definition);
    }
  });
});

describe("ingest contract", () => {
  const event = {
    type: "booking.confirmed",
    schema_version: 1,
    recipient: { external_id: "cust_1042" },
    idempotency_key: "booking:bkg_8821:confirmed",
    data: { booking_id: "bkg_8821" },
  };

  it("accepts a valid event", () => {
    expect(IngestEventSchema.parse(event)).toMatchObject(event);
  });

  it("defaults missing data", () => {
    const parsed = IngestEventSchema.parse({ ...event, data: undefined });
    expect(parsed.data).toEqual({});
  });

  it("rejects an unknown field", () => {
    expect(IngestEventSchema.safeParse({ ...event, source: "booking" }).success).toBe(false);
  });

  it("rejects a malformed event type", () => {
    expect(IngestEventSchema.safeParse({ ...event, type: "Booking Confirmed" }).success).toBe(false);
  });
});
