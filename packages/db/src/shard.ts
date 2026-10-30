import { createHash } from "node:crypto";

export const shardForUser = (userId: string, shardCount: number): number => {
  if (shardCount < 1) {
    throw new RangeError("shardCount must be at least 1");
  }

  const digest = createHash("sha256").update(userId).digest();
  return digest.readUInt32BE(0) % shardCount;
};
