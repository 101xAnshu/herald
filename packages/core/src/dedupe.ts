import type { Source } from "@herald/contracts";

export const dedupeKey = (userId: string, source: Source, idempotencyKey: string): string =>
  `dedupe:${userId}:${source}:${idempotencyKey}`;
