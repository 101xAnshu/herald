import type { Response } from "express";

import type { ErrorCode, PaginationMeta, ValidationIssue } from "@herald/contracts";

export const sendSuccess = <T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: PaginationMeta,
): void => {
  res.status(statusCode).json({
    data,
    ...(meta ? { meta } : {}),
    trace_id: res.locals.traceId ?? "",
  });
};

export const sendError = (
  res: Response,
  code: ErrorCode,
  message: string,
  statusCode = 400,
  details?: Record<string, unknown>,
  errors?: ValidationIssue[],
): void => {
  res.status(statusCode).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      ...(errors ? { errors } : {}),
    },
    trace_id: res.locals.traceId ?? "",
  });
};
