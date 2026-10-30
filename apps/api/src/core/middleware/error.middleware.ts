import { AppError } from "@herald/core";
import { logger } from "@herald/observability";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

import { sendError } from "../http/response";

interface PrismaLikeError {
  code?: string;
  meta?: Record<string, unknown>;
}

export const errorMiddleware = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (res.headersSent) {
    logger.error({ err: error, trace_id: req.traceId }, "error after headers were sent");
    res.end();
    return;
  }

  if (error instanceof AppError) {
    if (error.statusCode === 429 || error.code === "dependency_unavailable") {
      const retryAfter = error.details?.["retry_after_seconds"];
      res.setHeader("Retry-After", String(typeof retryAfter === "number" ? retryAfter : 1));
    }

    if (error.statusCode >= 500) {
      logger.error({ err: error, trace_id: req.traceId }, error.message);
    }

    sendError(res, error.code, error.message, error.statusCode, error.details, error.errors);
    return;
  }

  if (error instanceof ZodError) {
    sendError(
      res,
      "validation_failed",
      "Request is invalid",
      422,
      undefined,
      error.issues.map((issue) => ({
        field: issue.path.map(String).join(".") || "_",
        code: issue.code,
        message: issue.message,
      })),
    );
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    sendError(res, "invalid_request", "Malformed JSON body", 400);
    return;
  }

  if (typeof error === "object" && error !== null && "type" in error) {
    if ((error as { type: string }).type === "entity.too.large") {
      sendError(res, "validation_failed", "Request body exceeds the size limit", 422);
      return;
    }
  }

  const prismaError = error as PrismaLikeError;

  if (prismaError.code === "P2025") {
    sendError(res, "not_found", "Resource not found", 404);
    return;
  }

  if (prismaError.code === "P2002") {
    sendError(res, "idempotency_conflict", "A unique constraint was violated", 409, prismaError.meta);
    return;
  }

  logger.error({ err: error, trace_id: req.traceId }, "unhandled request error");
  sendError(res, "internal_error", "Unexpected server error", 500);
};
