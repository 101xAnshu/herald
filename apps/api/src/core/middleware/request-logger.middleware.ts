import { logger } from "@herald/observability";
import type { NextFunction, Request, Response } from "express";

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const started = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);

    logger.info(
      {
        trace_id: req.traceId,
        method: req.method,
        route: req.route?.path ?? req.path,
        status: res.statusCode,
        duration_ms: durationMs,
        source: req.apiClient?.source,
        ip: req.ip,
      },
      "request completed",
    );
  });

  next();
};
