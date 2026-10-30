import { relayOutbox } from "@herald/db";
import type { QueuePublisher } from "@herald/core";
import { jobDuration, jobLastSuccess, logger } from "@herald/observability";

export const runRelayLoop = async (
  publisher: QueuePublisher,
  signal: AbortSignal,
): Promise<void> => {
  while (!signal.aborted) {
    const started = process.hrtime.bigint();

    try {
      const result = await relayOutbox(publisher, 100);
      jobDuration.observe({ job: "relay" }, Number(process.hrtime.bigint() - started) / 1e9);
      jobLastSuccess.labels("relay", "all").set(Math.floor(Date.now() / 1000));

      if (result.published > 0 || result.failed > 0) {
        logger.info(result, "outbox relay tick");
      }
    } catch (error) {
      logger.error({ err: error }, "outbox relay failed");
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};
