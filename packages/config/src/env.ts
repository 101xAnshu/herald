import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";

import dotenv from "dotenv";
import { z } from "zod";

const WORKER_ROLES = [
  "relay",
  "orchestrator",
  "delivery",
  "scheduler",
  "reconciler",
  "campaign",
  "retention",
] as const;

export type WorkerRole = (typeof WORKER_ROLES)[number];

const booleanValue = (defaultValue: "true" | "false") =>
  z
    .enum(["true", "false", "1", "0"])
    .default(defaultValue)
    .transform((value) => value === "true" || value === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://herald:herald@localhost:5433/herald"),
  SHARD_COUNT: z.coerce.number().int().min(1).default(1),
  SHARD_DATABASE_URLS: z.string().default(""),

  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  KAFKA_BROKERS: z.string().min(1).default("localhost:9092"),
  KAFKA_PARTITIONS: z.coerce.number().int().min(1).default(6),
  WORKER_ROLES: z.string().default(WORKER_ROLES.join(",")),

  SMTP_URL: z.string().min(1).default("smtp://localhost:1025"),
  MAILPIT_URL: z.string().url().default("http://localhost:8025"),
  WEBHOOK_SECRET: z.string().min(1).default("herald-dev-webhook-secret"),

  JWT_SECRET: z.string().min(16).default("herald-dev-jwt-secret-change-me"),
  API_KEY_PEPPER: z.string().min(16).default("herald-dev-api-key-pepper"),
  DEMO_MODE: booleanValue("true"),
  ALLOW_CRITICAL_WHEN_PAUSED: booleanValue("true"),

  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  CAMPAIGN_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  CAMPAIGN_RATE_LIMIT: z.coerce.number().int().min(1).default(50),
  INBOX_RETENTION_DAYS: z.coerce.number().int().min(1).max(180).default(30),
  OUTBOX_MAX_PENDING_ROWS: z.coerce.number().int().min(1).default(100_000),
  OUTBOX_MAX_AGE_SECONDS: z.coerce.number().int().min(1).default(300),
});

export type Env = z.infer<typeof envSchema>;

export interface HeraldConfig {
  readonly nodeEnv: Env["NODE_ENV"];
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly port: number;
  readonly databaseUrl: string;
  readonly shardDatabaseUrls: readonly string[];
  readonly shardCount: number;
  readonly redisUrl: string;
  readonly kafkaBrokers: readonly string[];
  readonly kafkaPartitions: number;
  readonly workerRoles: readonly WorkerRole[];
  readonly smtpUrl: string;
  readonly mailpitUrl: string;
  readonly webhookSecret: string;
  readonly jwtSecret: string;
  readonly apiKeyPepper: string;
  readonly demoMode: boolean;
  readonly allowCriticalWhenPaused: boolean;
  readonly logLevel: Env["LOG_LEVEL"];
  readonly campaignBatchSize: number;
  readonly campaignRateLimit: number;
  readonly inboxRetentionDays: number;
  readonly outboxMaxPendingRows: number;
  readonly outboxMaxAgeSeconds: number;
}

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

const parseRoles = (raw: string): WorkerRole[] => {
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const roles = values.length > 0 ? values : [...WORKER_ROLES];
  const invalid = roles.filter((role) => !WORKER_ROLES.includes(role as WorkerRole));

  if (invalid.length > 0) {
    throw new ConfigError([`WORKER_ROLES contains unknown roles: ${invalid.join(", ")}`]);
  }

  return [...new Set(roles)] as WorkerRole[];
};

export const parseConfig = (source: NodeJS.ProcessEnv = process.env): HeraldConfig => {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => {
        const path = issue.path.join(".") || "environment";
        return `${path}: ${issue.message}`;
      }),
    );
  }

  const env = result.data;
  const extraShardUrls = env.SHARD_DATABASE_URLS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const shardDatabaseUrls = [env.DATABASE_URL, ...extraShardUrls];

  if (shardDatabaseUrls.length !== env.SHARD_COUNT) {
    throw new ConfigError([
      `SHARD_COUNT is ${env.SHARD_COUNT} but ${shardDatabaseUrls.length} database URL(s) were provided`,
    ]);
  }

  if (env.NODE_ENV === "production") {
    if (env.JWT_SECRET === "herald-dev-jwt-secret-change-me") {
      throw new ConfigError(["JWT_SECRET must be set in production"]);
    }

    if (env.API_KEY_PEPPER === "herald-dev-api-key-pepper") {
      throw new ConfigError(["API_KEY_PEPPER must be set in production"]);
    }
  }

  return Object.freeze({
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
    isTest: env.NODE_ENV === "test",
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    shardDatabaseUrls: Object.freeze(shardDatabaseUrls),
    shardCount: env.SHARD_COUNT,
    redisUrl: env.REDIS_URL,
    kafkaBrokers: Object.freeze(
      env.KAFKA_BROKERS.split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
    kafkaPartitions: env.KAFKA_PARTITIONS,
    workerRoles: Object.freeze(parseRoles(env.WORKER_ROLES)),
    smtpUrl: env.SMTP_URL,
    mailpitUrl: env.MAILPIT_URL,
    webhookSecret: env.WEBHOOK_SECRET,
    jwtSecret: env.JWT_SECRET,
    apiKeyPepper: env.API_KEY_PEPPER,
    demoMode: env.DEMO_MODE,
    allowCriticalWhenPaused: env.ALLOW_CRITICAL_WHEN_PAUSED,
    logLevel: env.LOG_LEVEL,
    campaignBatchSize: env.CAMPAIGN_BATCH_SIZE,
    campaignRateLimit: env.CAMPAIGN_RATE_LIMIT,
    inboxRetentionDays: env.INBOX_RETENTION_DAYS,
    outboxMaxPendingRows: env.OUTBOX_MAX_PENDING_ROWS,
    outboxMaxAgeSeconds: env.OUTBOX_MAX_AGE_SECONDS,
  });
};

let cached: HeraldConfig | undefined;

const findEnvFile = (start: string): string | undefined => {
  let directory = start;

  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = join(directory, ".env");

    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(directory);

    if (parent === directory || directory === parse(directory).root) {
      break;
    }

    directory = parent;
  }

  return undefined;
};

export const loadConfig = (source?: NodeJS.ProcessEnv): HeraldConfig => {
  if (source) {
    return parseConfig(source);
  }

  if (cached) {
    return cached;
  }

  const envFile = findEnvFile(process.cwd());

  if (envFile) {
    dotenv.config({ path: envFile, quiet: true });
  }

  cached = parseConfig(process.env);
  return cached;
};

export const resetConfig = (): void => {
  cached = undefined;
};
