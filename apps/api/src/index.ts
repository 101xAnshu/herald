import cluster from "node:cluster";

import { loadConfig } from "@herald/config";
import { logger } from "@herald/observability";

import { startServer } from "./server";

const config = loadConfig();
let shuttingDown = false;

if (cluster.isPrimary && config.apiWorkers > 1) {
  logger.info({ workers: config.apiWorkers }, "starting api cluster");

  for (let index = 0; index < config.apiWorkers; index += 1) {
    cluster.fork();
  }

  cluster.on("exit", (worker, code) => {
    if (shuttingDown) {
      return;
    }

    logger.warn({ worker: worker.id, code }, "api worker exited, restarting");
    cluster.fork();
  });

  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info({ signal }, "stopping api cluster");
    const timer = setTimeout(() => process.exit(1), 25_000);
    timer.unref();

    for (const worker of Object.values(cluster.workers ?? {})) {
      worker?.kill("SIGTERM");
    }

    cluster.on("exit", () => {
      if (Object.keys(cluster.workers ?? {}).length === 0) {
        clearTimeout(timer);
        process.exit(0);
      }
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
} else {
  void startServer();
}
