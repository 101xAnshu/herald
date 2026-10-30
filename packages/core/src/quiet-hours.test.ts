import { describe, expect, it } from "vitest";

import { parseTimeOfDay, isQuietHours, nextQuietHoursEnd, nextLocalMidnight } from "./quiet-hours";

const kolkata = "Asia/Kolkata";

describe("quiet hours", () => {
  it("parses times of day", () => {
    expect(parseTimeOfDay("00:00")).toBe(0);
    expect(parseTimeOfDay("22:30")).toBe(1350);
    expect(() => parseTimeOfDay("24:00")).toThrow(RangeError);
  });

  it("handles an overnight window in the user timezone", () => {
    const window = { start: "22:00", end: "07:00", timezone: kolkata };
    const inside = new Date("2026-10-30T18:00:00Z");
    const outside = new Date("2026-10-30T10:00:00Z");

    expect(isQuietHours(inside, window)).toBe(true);
    expect(isQuietHours(outside, window)).toBe(false);
  });

  it("handles a daytime window", () => {
    const window = { start: "09:00", end: "17:00", timezone: kolkata };

    expect(isQuietHours(new Date("2026-10-30T05:00:00Z"), window)).toBe(true);
    expect(isQuietHours(new Date("2026-10-30T13:00:00Z"), window)).toBe(false);
  });

  it("finds the next allowed instant", () => {
    const window = { start: "22:00", end: "07:00", timezone: kolkata };
    const inside = new Date("2026-10-30T18:00:00Z");
    const end = nextQuietHoursEnd(inside, window);

    expect(end.toISOString()).toBe("2026-10-31T01:30:00.000Z");
  });

  it("finds the next local midnight", () => {
    const midnight = nextLocalMidnight(new Date("2026-10-30T18:00:00Z"), kolkata);

    expect(midnight.toISOString()).toBe("2026-10-30T18:30:00.000Z");
  });

  it("treats an equal start and end as disabled", () => {
    expect(
      isQuietHours(new Date("2026-10-30T18:00:00Z"), {
        start: "22:00",
        end: "22:00",
        timezone: kolkata,
      }),
    ).toBe(false);
  });
});
