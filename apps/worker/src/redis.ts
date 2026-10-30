import { RedisStore } from "@herald/cache";

let store: RedisStore | undefined;

export const redis = (): RedisStore => {
  store ??= new RedisStore();
  return store;
};

export const disconnectRedis = async (): Promise<void> => {
  await store?.disconnect();
  store = undefined;
};
