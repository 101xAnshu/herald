import { describe, expect, it } from "vitest";

import { shardForUser } from "./shard";

describe("shard routing", () => {
  it("is deterministic", () => {
    expect(shardForUser("user-1", 12)).toBe(shardForUser("user-1", 12));
  });

  it("stays inside the shard range", () => {
    for (let index = 0; index < 100; index += 1) {
      const shard = shardForUser(`user-${index}`, 12);
      expect(shard).toBeGreaterThanOrEqual(0);
      expect(shard).toBeLessThan(12);
    }
  });

  it("maps everything to shard zero in local mode", () => {
    expect(shardForUser("user-1", 1)).toBe(0);
  });

  it("rejects an invalid shard count", () => {
    expect(() => shardForUser("user-1", 0)).toThrow(RangeError);
  });
});
