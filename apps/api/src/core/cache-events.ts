import {
  clearApiKeyCache,
  clearBacklogCache,
  clearEventTypeCache,
  clearSourceControlCache,
  clearTemplateCache,
} from "@herald/db";
import { logger } from "@herald/observability";

import { redis } from "./middleware/rate-limit.middleware";

const CACHE_CHANNEL = "herald:cache";
type Invalidation = "api_key" | "event_type" | "source" | "template" | "all";

const clearLocal = (type: Invalidation): void => {
  if (type === "api_key" || type === "all") {
    clearApiKeyCache();
  }

  if (type === "event_type" || type === "all") {
    clearEventTypeCache();
  }

  if (type === "source" || type === "all") {
    clearSourceControlCache();
  }

  if (type === "template" || type === "all") {
    clearTemplateCache();
  }

  if (type === "all") {
    clearBacklogCache();
  }
};

export const publishInvalidation = async (type: Invalidation): Promise<void> => {
  clearLocal(type);

  try {
    await redis().publish(CACHE_CHANNEL, { type });
  } catch (error) {
    logger.warn({ err: error, type }, "could not publish cache invalidation");
  }
};

export const startCacheInvalidation = async (): Promise<void> => {
  try {
    await redis().subscribe(CACHE_CHANNEL, (payload) => {
      const type = (payload as { type?: unknown }).type;

      if (
        type === "api_key" ||
        type === "event_type" ||
        type === "source" ||
        type === "template" ||
        type === "all"
      ) {
        clearLocal(type as Invalidation);
      }
    });
  } catch (error) {
    logger.warn({ err: error }, "cache invalidation subscription failed");
  }
};
