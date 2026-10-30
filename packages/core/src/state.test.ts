import { describe, expect, it } from "vitest";

import {
  aggregateNotificationStatus,
  transitionCampaign,
  transitionCampaignRecipient,
  transitionDelivery,
  transitionNotification,
  transitionRetry,
  isNotificationTerminal,
} from "./index";

describe("notification transitions", () => {
  it("allows the documented path to delivered", () => {
    expect(transitionNotification("accepted", "processing")).toMatchObject({ ok: true });
    expect(transitionNotification("processing", "partially_delivered")).toMatchObject({ ok: true });
    expect(transitionNotification("partially_delivered", "delivered")).toMatchObject({ ok: true });
  });

  it("treats a repeated transition as a no-op", () => {
    expect(transitionNotification("delivered", "delivered")).toEqual({
      ok: true,
      status: "delivered",
      changed: false,
    });
  });

  it("rejects terminal regression", () => {
    expect(transitionNotification("delivered", "processing")).toMatchObject({
      ok: false,
      code: "invalid_transition",
    });
    expect(isNotificationTerminal("suppressed")).toBe(true);
  });

  it("aggregates delivery outcomes", () => {
    expect(aggregateNotificationStatus("processing", ["accepted", "pending"])).toBe(
      "partially_delivered",
    );
    expect(aggregateNotificationStatus("processing", ["accepted", "delivered"])).toBe("delivered");
    expect(aggregateNotificationStatus("processing", ["failed", "failed"])).toBe("failed");
    expect(aggregateNotificationStatus("processing", ["suppressed", "suppressed"])).toBe(
      "suppressed",
    );
    expect(aggregateNotificationStatus("processing", ["accepted", "failed"])).toBe("delivered");
  });
});

describe("delivery transitions", () => {
  it("allows retry and ambiguity paths", () => {
    expect(transitionDelivery("pending", "sending")).toMatchObject({ ok: true });
    expect(transitionDelivery("sending", "retry_scheduled")).toMatchObject({ ok: true });
    expect(transitionDelivery("retry_scheduled", "sending")).toMatchObject({ ok: true });
    expect(transitionDelivery("sending", "unknown")).toMatchObject({ ok: true });
    expect(transitionDelivery("unknown", "delivered")).toMatchObject({ ok: true });
  });

  it("does not allow a terminal delivery to send again", () => {
    expect(transitionDelivery("delivered", "sending")).toMatchObject({ ok: false });
    expect(transitionDelivery("canceled", "sending")).toMatchObject({ ok: false });
  });
});

describe("campaign and retry transitions", () => {
  it("moves a campaign through pause and resume", () => {
    expect(transitionCampaign("draft", "running")).toMatchObject({ ok: true });
    expect(transitionCampaign("running", "paused")).toMatchObject({ ok: true });
    expect(transitionCampaign("paused", "running")).toMatchObject({ ok: true });
    expect(transitionCampaign("running", "completed")).toMatchObject({ ok: true });
    expect(transitionCampaign("completed", "running")).toMatchObject({ ok: false });
  });

  it("guards recipient states", () => {
    expect(transitionCampaignRecipient("pending", "queued")).toMatchObject({ ok: true });
    expect(transitionCampaignRecipient("queued", "sent")).toMatchObject({ ok: true });
    expect(transitionCampaignRecipient("sent", "delivered")).toMatchObject({ ok: true });
    expect(transitionCampaignRecipient("delivered", "queued")).toMatchObject({ ok: false });
  });

  it("guards retry states", () => {
    expect(transitionRetry("pending", "claimed")).toMatchObject({ ok: true });
    expect(transitionRetry("claimed", "succeeded")).toMatchObject({ ok: true });
    expect(transitionRetry("succeeded", "pending")).toMatchObject({ ok: false });
  });
});
