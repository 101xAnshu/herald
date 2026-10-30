import { createMockStatusResolver } from "@herald/providers";
import { reconcileUnknownDeliveries } from "@herald/db";
import { jobDuration, jobLastSuccess, logger } from "@herald/observability";

export const runReconcilerLoop = async (signal: AbortSignal): Promise<void> => {
  const resolver = createMockStatusResolver();

  while (!signal.aborted) {
    const started = process.hrtime.bigint();

    try {
      const result = await reconcileUnknownDeliveries(resolver, { olderThanSeconds: 30 });
      jobDuration.observe({ job: "reconciler" }, Number(process.hrtime.bigint() - started) / 1e9);
      jobLastSuccess.labels("reconciler", "all").set(Math.floor(Date.now() / 1000));

      if (result.inspected > 0) {
        logger.info(result, "reconciler inspected ambiguous deliveries");
      }
    } catch (error) {
      logger.error({ err: error }, "reconciler tick failed");
    }

    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
};
