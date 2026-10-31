import { getPrisma, prisma } from "@herald/db";

export { prisma };

export const databaseReady = async (): Promise<boolean> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
};

export const migrationsReady = async (): Promise<boolean> => {
  try {
    const rows = await prisma.$queryRaw<Array<{ finished_at: Date | null; rolled_back_at: Date | null }>>`
      SELECT finished_at, rolled_back_at
      FROM _prisma_migrations
    `;

    return rows.length > 0 && rows.every((row) => row.finished_at !== null || row.rolled_back_at !== null);
  } catch {
    return false;
  }
};

export const shardReady = async (shard: number): Promise<boolean> => {
  try {
    await getPrisma(shard).$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
};
