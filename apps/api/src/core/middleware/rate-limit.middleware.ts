import { RedisStore } from "@herald/cache";
import { AppError } from "@herald/core";
import { logger } from "@herald/observability";
import type { NextFunction, Request, Response } from "express";

let store: RedisStore | undefined;

export const redis = (): RedisStore => {
  store ??= new RedisStore();
  return store;
};

export const disconnectRedis = async (): Promise<void> => {
  await store?.disconnect();
  store = undefined;
};

type Scope = "api_key" | "source" | "ip" | "user";

const identify = (req: Request, scope: Scope): string => {
  switch (scope) {
    case "api_key":
      return req.apiClient?.id ?? "anonymous";
    case "source":
      return req.apiClient?.source ?? "anonymous";
    case "user":
      return req.userId ?? "anonymous";
    default:
      return req.ip ?? "unknown";
  }
};

export const rateLimit = (scope: Scope, limit: number, windowSeconds: number) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await redis().rateLimit(scope, identify(req, scope), limit, windowSeconds);

      res.setHeader("X-RateLimit-Limit", String(result.limit));
      res.setHeader("X-RateLimit-Remaining", String(result.remaining));
      res.setHeader("X-RateLimit-Reset", String(result.resetSeconds));

      if (!result.allowed) {
        res.setHeader("Retry-After", String(result.resetSeconds));
        throw new AppError("rate_limited", "Rate limit exceeded", 429, {
          details: { scope, retry_after_seconds: result.resetSeconds },
        });
      }

      next();
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
        return;
      }

      logger.warn({ err: error, scope }, "rate limiter unavailable, allowing request");
      next();
    }
  };
};
