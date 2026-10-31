import { randomBytes } from "node:crypto";

import type { ApiKeyCreate, ApiKeyRotate, Scope, Source } from "@herald/contracts";
import { AppError, constantTimeEqual, newId, hashToken } from "@herald/core";
import { loadConfig } from "@herald/config";
import type { Source as DbSource } from "../generated/prisma/enums";
import type { Db } from "../prisma";
import { scopesFromDb, sourceFromDb, sourceToDb } from "../mappers";

interface CachedApiClient {
  id: string;
  source: DbSource;
  scopes: string[];
  name: string;
  keyHash: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
}

const apiKeyCache = new Map<string, { client: CachedApiClient; expiresAt: number }>();
const API_KEY_CACHE_TTL_MS = 5_000;

export interface IssuedApiKey {
  id: string;
  key: string;
  prefix: string;
  source: Source;
  scopes: Scope[];
  expires_at: string | null;
}

const generateKey = (source: Source): string =>
  `hrld_${source}_${randomBytes(24).toString("base64url")}`;

const prefixOf = (key: string): string => key.slice(0, 20);

export const issueApiKey = async (
  db: Db,
  input: ApiKeyCreate,
  actor: string,
): Promise<IssuedApiKey> => {
  apiKeyCache.clear();
  const config = loadConfig();
  const raw = generateKey(input.source);
  const id = newId();
  const expiresAt = new Date(Date.now() + input.expires_in_days * 86_400_000);
  const prefix = prefixOf(raw);

  await db.$transaction(async (tx) => {
    await tx.apiClient.create({
      data: {
        id,
        source: sourceToDb(input.source),
        kind: "SERVICE",
        name: input.name,
        keyPrefix: prefix,
        keyHash: hashToken(raw, config.apiKeyPepper),
        scopes: input.scopes,
        expiresAt,
        createdBy: actor,
      },
    });

    await tx.auditLog.create({
      data: {
        id: newId(),
        actorLabel: actor,
        action: "api_key.create",
        resourceType: "api_client",
        resourceId: id,
        result: "SUCCESS",
        traceId: newId(),
        metadata: { name: input.name, source: input.source, scopes: input.scopes },
      },
    });
  });

  return {
    id,
    key: raw,
    prefix,
    source: input.source,
    scopes: input.scopes,
    expires_at: expiresAt.toISOString(),
  };
};

export const authenticateApiKey = async (db: Db, raw: string) => {
  const config = loadConfig();
  const prefix = prefixOf(raw);
  const cached = apiKeyCache.get(prefix);
  let client: CachedApiClient | null = null;

  if (cached && cached.expiresAt > Date.now()) {
    client = cached.client;
  } else {
    const row = await db.apiClient.findUnique({ where: { keyPrefix: prefix } });

    if (row) {
      client = {
        id: row.id,
        source: row.source,
        scopes: row.scopes,
        name: row.name,
        keyHash: row.keyHash,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        lastUsedAt: row.lastUsedAt,
      };
      apiKeyCache.set(prefix, { client, expiresAt: Date.now() + API_KEY_CACHE_TTL_MS });
    }
  }

  if (!client) {
    return null;
  }

  const now = new Date();

  if (client.revokedAt || (client.expiresAt && client.expiresAt <= now)) {
    return null;
  }

  const expected = hashToken(raw, config.apiKeyPepper);

  if (!constantTimeEqual(expected, client.keyHash)) {
    return null;
  }

  if (!client.lastUsedAt || now.getTime() - client.lastUsedAt.getTime() > 60_000) {
    client.lastUsedAt = now;
    void db.apiClient
      .update({ where: { id: client.id }, data: { lastUsedAt: now } })
      .catch(() => undefined);
  }

  return {
    id: client.id,
    source: sourceFromDb(client.source),
    scopes: scopesFromDb(client.scopes),
    name: client.name,
  };
};

export const rotateApiKey = async (
  db: Db,
  id: string,
  input: ApiKeyRotate,
  actor: string,
): Promise<IssuedApiKey> => {
  apiKeyCache.clear();
  const config = loadConfig();
  const existing = await db.apiClient.findUnique({ where: { id } });

  if (!existing) {
    throw new AppError("not_found", "API key not found", 404);
  }

  if (existing.revokedAt) {
    throw new AppError("validation_failed", "API key is already revoked", 422);
  }

  const raw = generateKey(sourceFromDb(existing.source));
  const newIdValue = newId();
  const prefix = prefixOf(raw);
  const expiresAt = existing.expiresAt ?? new Date(Date.now() + 365 * 86_400_000);
  const overlapUntil = new Date(Date.now() + input.overlap_seconds * 1000);

  await db.$transaction(async (tx) => {
    await tx.apiClient.create({
      data: {
        id: newIdValue,
        source: existing.source,
        kind: existing.kind,
        name: existing.name,
        keyPrefix: prefix,
        keyHash: hashToken(raw, config.apiKeyPepper),
        scopes: existing.scopes,
        expiresAt,
        rotatedFromId: existing.id,
        createdBy: actor,
      },
    });

    await tx.apiClient.update({
      where: { id: existing.id },
      data: { expiresAt: overlapUntil },
    });

    await tx.auditLog.create({
      data: {
        id: newId(),
        actorLabel: actor,
        action: "api_key.rotate",
        resourceType: "api_client",
        resourceId: newIdValue,
        result: "SUCCESS",
        traceId: newId(),
        metadata: { rotated_from: existing.id, overlap_seconds: input.overlap_seconds },
      },
    });
  });

  return {
    id: newIdValue,
    key: raw,
    prefix,
    source: sourceFromDb(existing.source),
    scopes: scopesFromDb(existing.scopes),
    expires_at: expiresAt.toISOString(),
  };
};

export const revokeApiKey = async (db: Db, id: string, actor: string) => {
  apiKeyCache.clear();
  const existing = await db.apiClient.findUnique({ where: { id } });

  if (!existing) {
    throw new AppError("not_found", "API key not found", 404);
  }

  await db.$transaction([
    db.apiClient.update({ where: { id }, data: { revokedAt: new Date() } }),
    db.auditLog.create({
      data: {
        id: newId(),
        actorLabel: actor,
        action: "api_key.revoke",
        resourceType: "api_client",
        resourceId: id,
        result: "SUCCESS",
        traceId: newId(),
        metadata: { prefix: existing.keyPrefix },
      },
    }),
  ]);
};
