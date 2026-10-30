import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiKeyForSource, readConfig, writeConfig } from "./config";

const previous = process.env["HERALD_CONFIG"];

beforeEach(() => {
  process.env["HERALD_CONFIG"] = join(mkdtempSync(join(tmpdir(), "herald-cli-")), "config.toml");
});

afterEach(() => {
  if (previous) {
    process.env["HERALD_CONFIG"] = previous;
  } else {
    delete process.env["HERALD_CONFIG"];
  }
});

describe("cli profile", () => {
  it("round-trips a profile", () => {
    writeConfig({
      defaultProfile: "local",
      profiles: {
        local: {
          apiUrl: "http://localhost:3000",
          apiKey: "hrld_ops",
          source: "ops",
          keys: { booking: "hrld_booking" },
        },
      },
    });

    const config = readConfig();
    expect(config.defaultProfile).toBe("local");
    expect(config.profiles.local?.apiKey).toBe("hrld_ops");
    expect(apiKeyForSource(config.profiles.local!, "booking")).toBe("hrld_booking");
    expect(apiKeyForSource(config.profiles.local!, "security")).toBe("hrld_ops");
  });

  it("falls back to an empty config", () => {
    expect(readConfig()).toEqual({ defaultProfile: "local", profiles: {} });
  });
});
