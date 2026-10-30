import { httpRequestDuration, httpRequestsTotal } from "@herald/observability";
import type { NextFunction, Request, Response } from "express";

export const metricsMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const started = process.hrtime.bigint();

  res.on("finish", () => {
    const route = req.route?.path ?? req.path;
    const labels = {
      route,
      method: req.method,
      status: String(res.statusCode),
      source: req.apiClient?.source ?? "none",
    };

    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(
      { route, method: req.method },
      Number(process.hrtime.bigint() - started) / 1_000_000_000,
    );
  });

  next();
};
