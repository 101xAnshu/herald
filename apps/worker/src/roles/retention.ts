import { runRetention } from "@herald/db";
import { jobDuration, jobLastSuccess, logger } from "@herald/observability";

export const runRetentionLoop = async (signal: AbortSignal): Promise<void> => {
  while (!signal.aborted) {
    const started = process.hrtime.bigint();

    try {
      const result = await runRetention();
      jobDuration.observe({ job: "retention" }, Number(process.hrtime.bigint() - started) / 1e9);
      jobLastSuccess.labels("retention", "all").set(Math.floor(Date.now() / 1000));
      logger.info(result, "retention run completed");
    } catch (error) {
      logger.error({ err: error }, "retention run failed");
    }

    await new Promise((resolve) => setTimeout(resolve, 60 * 60 * 1000));
  }
};
