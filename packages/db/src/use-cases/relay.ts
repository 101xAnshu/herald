import type { MessageHeaders, QueuePublisher } from "@herald/core";
import { loadConfig } from "@herald/config";
import { getPrisma } from "../prisma";

export interface RelayResult {
  published: number;
  failed: number;
}

const headersOf = (value: unknown): MessageHeaders => {
  if (!value || typeof value !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      item === null || item === undefined ? null : String(item),
    ]),
  );
};

export const relayOutbox = async (
  publisher: QueuePublisher,
  batchSize = 100,
): Promise<RelayResult> => {
  const config = loadConfig();
  let published = 0;
  let failed = 0;

  for (let shard = 0; shard < config.shardCount; shard += 1) {
    const db = getPrisma(shard);

    const result = await db.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM outbox
        WHERE status = 'pending' AND available_at <= now()
        ORDER BY available_at ASC, id ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `;

      if (claimed.length === 0) {
        return { published: 0, failed: 0 };
      }

      const ids = claimed.map((row) => row.id);
      const rows = await tx.outbox.findMany({ where: { id: { in: ids } } });
      const publishedIds: string[] = [];
      let localFailed = 0;

      for (const row of rows) {
        try {
          await publisher.publish(
            row.topic,
            row.partitionKey,
            row.payload,
            headersOf(row.headers),
          );
          publishedIds.push(row.id);
        } catch (error) {
          localFailed += 1;
          const attempts = row.attempts + 1;

          await tx.outbox.update({
            where: { id: row.id },
            data: {
              attempts,
              lastError: error instanceof Error ? error.message.slice(0, 500) : "publish failed",
              availableAt: new Date(Date.now() + Math.min(30_000 * attempts, 300_000)),
              status: attempts >= 10 ? "FAILED" : "PENDING",
            },
          });
        }
      }

      if (publishedIds.length > 0) {
        await tx.outbox.updateMany({
          where: { id: { in: publishedIds } },
          data: { status: "PUBLISHED", publishedAt: new Date() },
        });
      }

      return { published: publishedIds.length, failed: localFailed };
    });

    published += result.published;
    failed += result.failed;
  }

  return { published, failed };
};
