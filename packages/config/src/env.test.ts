import { describe, expect, it } from "vitest";

import { ConfigError, parseConfig } from "./env";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://herald:herald@localhost:5433/herald",
  REDIS_URL: "redis://localhost:6379",
  KAFKA_BROKERS: "localhost:9092,localhost:9093",
  WORKER_ROLES: "relay,delivery",
};

describe("parseConfig", () => {
  it("applies defaults and derives lists", () => {
    const config = parseConfig(baseEnv);

    expect(config.port).toBe(3000);
    expect(config.shardCount).toBe(1);
    expect(config.shardDatabaseUrls).toEqual([baseEnv.DATABASE_URL]);
    expect(config.kafkaBrokers).toEqual(["localhost:9092", "localhost:9093"]);
    expect(config.workerRoles).toEqual(["relay", "delivery"]);
    expect(config.demoMode).toBe(true);
  });

  it("requires one URL per shard", () => {
    expect(() =>
      parseConfig({
        ...baseEnv,
        SHARD_COUNT: "2",
        SHARD_DATABASE_URLS: "",
      }),
    ).toThrow(ConfigError);
  });

  it("accepts additional shard URLs", () => {
    const config = parseConfig({
      ...baseEnv,
      SHARD_COUNT: "2",
      SHARD_DATABASE_URLS: "postgresql://herald:herald@localhost:5433/herald",
    });

    expect(config.shardDatabaseUrls).toHaveLength(2);
  });

  it("rejects unknown worker roles", () => {
    expect(() =>
      parseConfig({
        ...baseEnv,
        WORKER_ROLES: "relay,emailer",
      }),
    ).toThrow(/unknown roles/);
  });

  it("requires real secrets in production", () => {
    expect(() =>
      parseConfig({
        ...baseEnv,
        NODE_ENV: "production",
        JWT_SECRET: "local-development-jwt-secret",
        API_KEY_PEPPER: "local-development-api-key-pepper",
      }),
    ).toThrow(/JWT_SECRET/);

    const config = parseConfig({
      ...baseEnv,
      NODE_ENV: "production",
      JWT_SECRET: "a-production-grade-secret-value",
      API_KEY_PEPPER: "a-production-grade-pepper-value",
    });

    expect(config.isProduction).toBe(true);
  });
});
