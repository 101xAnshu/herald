import { PrismaPg } from "@prisma/adapter-pg";
import { loadConfig } from "@herald/config";

import { PrismaClient } from "./generated/prisma/client";
import { shardForUser } from "./shard";

const clients = new Map<number, PrismaClient>();

export type Db = PrismaClient;

export const getPrisma = (shard = 0): PrismaClient => {
  const cached = clients.get(shard);

  if (cached) {
    return cached;
  }

  const config = loadConfig();
  const connectionString = config.shardDatabaseUrls[shard];

  if (!connectionString) {
    throw new RangeError(`No database URL configured for shard ${shard}`);
  }

  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  clients.set(shard, client);
  return client;
};

export const getPrismaForUser = (userId: string): PrismaClient => {
  const config = loadConfig();
  return getPrisma(shardForUser(userId, config.shardCount));
};

export const prisma = getPrisma(0);

export const disconnectPrisma = async (): Promise<void> => {
  await Promise.all([...clients.values()].map((client) => client.$disconnect()));
  clients.clear();
};

export const resetPrisma = (): void => {
  clients.clear();
};
