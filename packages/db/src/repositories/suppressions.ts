import type { Channel } from "@herald/contracts";

import { channelFromDb } from "../mappers";
import type { Db } from "../prisma";

interface SuppressionEntry {
  channel: Channel;
  reason: string;
}

const TTL_MS = 5_000;

const caches = new WeakMap<Db, { entries: Map<string, SuppressionEntry>; expiresAt: number }>();

/**
 * Suppression rows are hashed addresses with a channel and a reason. The table
 * is small and read on every send, so each process keeps a short-lived copy
 * instead of issuing one query per delivery. A new suppression becomes visible
 * within five seconds without a restart.
 */
export const loadSuppressionIndex = async (db: Db): Promise<Map<string, SuppressionEntry>> => {
  const cached = caches.get(db);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.entries;
  }

  const rows = await db.suppressionList.findMany({
    where: {
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { addressHash: true, channel: true, reason: true },
  });

  const entries = new Map(
    rows.map((row) => [row.addressHash, { channel: channelFromDb(row.channel), reason: row.reason }]),
  );

  caches.set(db, { entries, expiresAt: Date.now() + TTL_MS });

  return entries;
};
