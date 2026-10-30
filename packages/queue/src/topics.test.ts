import { describe, expect, it } from "vitest";

import { ALL_TOPICS, consumerGroup, deliveriesTopic, eventsTopic, topicRetention } from "./topics";

describe("topic catalog", () => {
  it("has ten topics", () => {
    expect(ALL_TOPICS).toHaveLength(10);
    expect(new Set(ALL_TOPICS).size).toBe(10);
  });

  it("separates priorities", () => {
    expect(eventsTopic("critical")).toBe("herald.events.critical.v1");
    expect(deliveriesTopic("low")).toBe("herald.deliveries.low.v1");
  });

  it("uses dedicated consumer groups", () => {
    expect(consumerGroup("orchestrator", "high")).toBe("herald-orchestrator-high");
    expect(consumerGroup("webhook")).toBe("herald-webhook");
  });

  it("keeps the DLQ longer", () => {
    expect(topicRetention("herald.dlq.v1")).toBeGreaterThan(topicRetention("herald.events.normal.v1"));
  });
});
