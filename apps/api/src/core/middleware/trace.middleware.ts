import { traceIdFromHeader } from "@herald/core";
import { runWithTrace } from "@herald/observability";
import type { NextFunction, Request, Response } from "express";

export const traceMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const traceId = traceIdFromHeader(req.header("x-trace-id"));
  req.traceId = traceId;
  res.locals.traceId = traceId;
  res.setHeader("X-Trace-Id", traceId);

  runWithTrace({ traceId }, next);
};
