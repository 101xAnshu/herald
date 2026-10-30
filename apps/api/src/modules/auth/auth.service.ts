import type { ApiKeyCreate, ApiKeyRotate } from "@herald/contracts";
import { AppError } from "@herald/core";
import {
  issueApiKey,
  prisma,
  resolveUserByExternalId,
  revokeApiKey,
  rotateApiKey,
} from "@herald/db";
import { loadConfig } from "@herald/config";
import jwt from "jsonwebtoken";

export const mintDemoToken = async (externalId: string) => {
  const config = loadConfig();

  if (!config.demoMode) {
    throw new AppError("not_found", "Demo mode is disabled", 404);
  }

  const user = await resolveUserByExternalId(prisma, externalId);

  if (!user || user.status !== "ACTIVE") {
    throw new AppError("not_found", "User not found", 404);
  }

  const token = jwt.sign(
    {
      sub: user.id,
      iss: "herald",
      aud: "herald-user",
    },
    config.jwtSecret,
    { expiresIn: 900 },
  );

  return {
    access_token: token,
    token_type: "Bearer" as const,
    expires_in: 900,
    user_id: user.id,
    external_id: user.externalId,
  };
};

export const createKey = (input: ApiKeyCreate, actor: string) => issueApiKey(prisma, input, actor);

export const rotateKey = (id: string, input: ApiKeyRotate, actor: string) =>
  rotateApiKey(prisma, id, input, actor);

export const revokeKey = (id: string, actor: string) => revokeApiKey(prisma, id, actor);

export const listKeys = async () => {
  const rows = await prisma.apiClient.findMany({ orderBy: { createdAt: "desc" } });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    source: row.source.toLowerCase(),
    kind: row.kind.toLowerCase(),
    prefix: row.keyPrefix,
    scopes: row.scopes,
    revoked_at: row.revokedAt?.toISOString() ?? null,
    expires_at: row.expiresAt?.toISOString() ?? null,
    last_used_at: row.lastUsedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  }));
};
