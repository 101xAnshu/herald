import { RedisStore } from "@herald/cache";
import { clearEventTypeCache, clearSourceControlCache } from "@herald/db";
import { logger } from "@herald/observability";

let store: RedisStore | undefined;

export const redis = (): RedisStore => {
  store ??= new RedisStore();
  return store;
};

export const startCacheInvalidation = async (): Promise<void> => {
  try {
    await redis().subscribe("herald:cache", (payload) => {
      const type = (payload as { type?: unknown }).type;

      if (type === "event_type" || type === "all") {
        clearEventTypeCache();
      }

      if (type === "source" || type === "all") {
        clearSourceControlCache();
      }
    });
  } catch (error) {
    logger.warn({ err: error }, "cache invalidation subscription failed");
  }
};

export const disconnectRedis = async (): Promise<void> => {
  await store?.disconnect();
  store = undefined;
};
