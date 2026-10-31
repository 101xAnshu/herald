import type { Server } from "node:http";

import { loadConfig } from "@herald/config";
import { disconnectPrisma } from "@herald/db";
import { logger, setBuildInfo } from "@herald/observability";
import { ensureTopics } from "@herald/queue";

import { createApp } from "./app";
import { startCacheInvalidation } from "./core/cache-events";
import { disconnectRedis } from "./core/middleware/rate-limit.middleware";

export const startServer = async (): Promise<Server> => {
  const config = loadConfig();
  setBuildInfo(process.env["npm_package_version"] ?? "0.1.0", process.env["GIT_COMMIT"] ?? "local");

  await ensureTopics(config.kafkaPartitions).catch((error: unknown) => {
    logger.warn({ err: error }, "could not ensure Kafka topics at startup");
  });

  await startCacheInvalidation();

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, docs: `http://localhost:${config.port}/docs` },
      "api listening",
    );
  });

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info({ signal }, "shutting down api");

    const timer = setTimeout(() => {
      logger.error("graceful shutdown timed out");
      process.exit(1);
    }, 25_000);
    timer.unref();

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await disconnectRedis();
    await disconnectPrisma();
    clearTimeout(timer);

    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  return server;
};
