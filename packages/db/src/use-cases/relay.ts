import type { MessageHeaders, QueuePublisher } from "@herald/core";
import { loadConfig } from "@herald/config";
import { getPrisma } from "../prisma";

export interface RelayResult {
  published: number;
  failed: number;
}

interface OutboxRow {
  id: string;
  topic: string;
  partition_key: string;
  payload: unknown;
  headers: unknown;
  attempts: number;
}

const LEASE_MS = 30_000;

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

/**
 * The relay leases a batch with `FOR UPDATE SKIP LOCKED`, commits, and only
 * then publishes. Publishing inside the transaction would hold a database
 * connection for every broker round trip. Messages are grouped by topic so one
 * batch becomes one produce request per topic.
 */
export const relayOutbox = async (
  publisher: QueuePublisher,
  batchSize = 100,
): Promise<RelayResult> => {
  const config = loadConfig();
  let published = 0;
  let failed = 0;

  for (let shard = 0; shard < config.shardCount; shard += 1) {
    const db = getPrisma(shard);

    const rows = await db.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<OutboxRow[]>`
        SELECT id, topic, partition_key, payload, headers, attempts
        FROM outbox
        WHERE status = 'pending' AND available_at <= now()
        ORDER BY available_at ASC, id ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `;

      if (claimed.length === 0) {
        return [];
      }

      await tx.outbox.updateMany({
        where: { id: { in: claimed.map((row) => row.id) } },
        data: { availableAt: new Date(Date.now() + LEASE_MS) },
      });

      return claimed;
    });

    if (rows.length === 0) {
      continue;
    }

    const byTopic = new Map<string, OutboxRow[]>();

    for (const row of rows) {
      const group = byTopic.get(row.topic);

      if (group) {
        group.push(row);
      } else {
        byTopic.set(row.topic, [row]);
      }
    }

    const publishedIds: string[] = [];

    for (const [topic, group] of byTopic) {
      try {
        if (publisher.publishMany) {
          await publisher.publishMany(
            topic,
            group.map((row) => ({
              key: row.partition_key,
              payload: row.payload,
              headers: headersOf(row.headers),
            })),
          );
        } else {
          for (const row of group) {
            await publisher.publish(
              topic,
              row.partition_key,
              row.payload,
              headersOf(row.headers),
            );
          }
        }

        publishedIds.push(...group.map((row) => row.id));
      } catch (error) {
        failed += group.length;

        for (const row of group) {
          const attempts = row.attempts + 1;

          await db.outbox.update({
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
    }

    if (publishedIds.length > 0) {
      await db.outbox.updateMany({
        where: { id: { in: publishedIds } },
        data: { status: "PUBLISHED", publishedAt: new Date() },
      });
      published += publishedIds.length;
    }
  }

  return { published, failed };
};
