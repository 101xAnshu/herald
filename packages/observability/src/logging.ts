import pino, { type Logger, type LoggerOptions } from "pino";

import { loadConfig } from "@herald/config";

const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "authorization",
  "api_key",
  "apiKey",
  "jwt",
  "password",
  "token",
  "email",
  "phone",
  "body",
  "payload",
  "recipient.email",
  "recipient.phone",
  "req.body",
  "res.headers",
];

export interface LoggerContext {
  service: string;
  traceId?: string;
  notificationId?: string;
  deliveryId?: string;
  campaignId?: string;
  source?: string;
  channel?: string;
  priority?: string;
  shard?: number;
}

export const createLogger = (context: LoggerContext, options: LoggerOptions = {}): Logger => {
  const config = loadConfig();

  return pino({
    level: config.logLevel,
    base: {
      service: context.service,
      ...(context.traceId ? { trace_id: context.traceId } : {}),
      ...(context.notificationId ? { notification_id: context.notificationId } : {}),
      ...(context.deliveryId ? { delivery_id: context.deliveryId } : {}),
      ...(context.campaignId ? { campaign_id: context.campaignId } : {}),
      ...(context.source ? { source: context.source } : {}),
      ...(context.channel ? { channel: context.channel } : {}),
      ...(context.priority ? { priority: context.priority } : {}),
      ...(context.shard !== undefined ? { shard: context.shard } : {}),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    serializers: {
      err: pino.stdSerializers.err,
    },
    ...options,
  });
};

export const logger = createLogger({ service: "herald" });
