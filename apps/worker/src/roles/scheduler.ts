import { runSchedulerJobs } from "@herald/db";
import { jobDuration, jobLastSuccess, logger } from "@herald/observability";

export const runSchedulerLoop = async (signal: AbortSignal): Promise<void> => {
  let tick = 0;

  while (!signal.aborted) {
    const started = process.hrtime.bigint();
    tick += 1;

    try {
      const result = await runSchedulerJobs(100, { recover: tick % 10 === 1 });
      jobDuration.observe({ job: "scheduler" }, Number(process.hrtime.bigint() - started) / 1e9);
      jobLastSuccess.labels("scheduler", "all").set(Math.floor(Date.now() / 1000));

      if (result.retries + result.notifications + result.campaigns > 0) {
        logger.info(result, "scheduler promoted work");
      }
    } catch (error) {
      logger.error({ err: error }, "scheduler tick failed");
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
};
