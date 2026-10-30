import type { Priority } from "@herald/contracts";
import { loadConfig } from "@herald/config";
import { disconnectPrisma } from "@herald/db";
import { logger, setBuildInfo } from "@herald/observability";
import { createAdapterRegistry } from "@herald/providers";
import { createPublisher, ensureTopics, type KafkaConsumer } from "@herald/queue";

import { startMetricsServer } from "./metrics-server";
import { disconnectRedis } from "./redis";
import { runCampaignLoop } from "./roles/campaign";
import { createDeliveryConsumers } from "./roles/delivery";
import { createOrchestratorConsumers } from "./roles/orchestrator";
import { runReconcilerLoop } from "./roles/reconciler";
import { runRelayLoop } from "./roles/relay";
import { runRetentionLoop } from "./roles/retention";
import { runSchedulerLoop } from "./roles/scheduler";

const PRIORITIES: Priority[] = ["critical", "high", "normal", "low"];

export const startWorker = async (): Promise<void> => {
  const config = loadConfig();
  setBuildInfo(process.env["npm_package_version"] ?? "0.1.0", process.env["GIT_COMMIT"] ?? "local");

  const controller = new AbortController();
  const consumers: KafkaConsumer[] = [];
  const loops: Promise<void>[] = [];

  const metricsServer = startMetricsServer(Number(process.env["WORKER_METRICS_PORT"] ?? 9100));
  const adapters = createAdapterRegistry();
  const publisher = createPublisher();

  await ensureTopics(config.kafkaPartitions).catch((error: unknown) => {
    logger.warn({ err: error }, "could not ensure Kafka topics");
  });

  logger.info({ roles: config.workerRoles }, "worker starting");

  if (config.workerRoles.includes("relay")) {
    loops.push(runRelayLoop(publisher, controller.signal));
  }

  if (config.workerRoles.includes("orchestrator")) {
    consumers.push(...createOrchestratorConsumers(PRIORITIES));
  }

  if (config.workerRoles.includes("delivery")) {
    consumers.push(...createDeliveryConsumers(adapters, PRIORITIES));
  }

  if (config.workerRoles.includes("scheduler")) {
    loops.push(runSchedulerLoop(controller.signal));
  }

  if (config.workerRoles.includes("campaign")) {
    loops.push(runCampaignLoop(controller.signal));
  }

  if (config.workerRoles.includes("reconciler")) {
    loops.push(runReconcilerLoop(controller.signal));
  }

  if (config.workerRoles.includes("retention")) {
    loops.push(runRetentionLoop(controller.signal));
  }

  for (const consumer of consumers) {
    await consumer.subscribe().catch((error: unknown) => {
      logger.error({ err: error }, "consumer failed to subscribe");
    });
  }

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info({ signal }, "worker shutting down");

    const timer = setTimeout(() => {
      logger.error("worker shutdown timed out");
      process.exit(1);
    }, 25_000);
    timer.unref();

    controller.abort();
    await Promise.all(consumers.map((consumer) => consumer.disconnect().catch(() => undefined)));
    await publisher.disconnect().catch(() => undefined);
    await disconnectRedis();
    await disconnectPrisma();
    await new Promise<void>((resolve) => metricsServer.close(() => resolve()));
    clearTimeout(timer);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
};

export const workerLoops = (): Promise<void>[] => [];
