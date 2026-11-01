import {
  EventTypePolicySchema,
  type Channel,
  type CreateEventType,
  type CreateTemplate,
  type CreateTemplateVersion,
  type EventTypeDefinition,
  type Priority,
  type Source,
  type UpdateEventType,
} from "@herald/contracts";
import { AppError, newId } from "@herald/core";
import type { Prisma } from "../generated/prisma/client";
import type { Db } from "../prisma";
import {
  channelFromDb,
  channelToDb,
  eventTypeStatusToDb,
  priorityFromDb,
  priorityToDb,
  sourceFromDb,
  sourceToDb,
} from "../mappers";

interface EventTypeRow {
  key: string;
  version: number;
  schema?: unknown;
  defaultPriority: string;
  allowedChannels: string[];
  allowedSources: string[];
  dedupeWindowSeconds: number;
  policy: unknown;
}

export const toEventTypeDefinition = (row: EventTypeRow): EventTypeDefinition => {
  const policy = EventTypePolicySchema.safeParse(row.policy);

  if (!policy.success) {
    throw new AppError("internal_error", "Stored event type policy is invalid", 500, {
      details: { key: row.key, issues: policy.error.issues.map((issue) => issue.message) },
    });
  }

  return {
    key: row.key,
    schema_version: row.version,
    schema: (row.schema ?? {}) as Record<string, unknown>,
    default_priority: priorityFromDb(row.defaultPriority as never),
    allowed_channels: row.allowedChannels.map((channel) => channelFromDb(channel as never)),
    allowed_sources: row.allowedSources.map((source) => sourceFromDb(source as never)),
    dedupe_window_seconds: row.dedupeWindowSeconds,
    policy: policy.data,
  };
};

const eventTypeCache = new Map<string, { definition: EventTypeDefinition; expiresAt: number }>();
const EVENT_TYPE_CACHE_TTL_MS = 5_000;

export const clearEventTypeCache = (): void => {
  eventTypeCache.clear();
};

export const getEventType = async (
  db: Db,
  key: string,
  version?: number,
): Promise<EventTypeDefinition | null> => {
  const cacheKey = `${key}:${version ?? "latest"}`;
  const cached = eventTypeCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.definition;
  }

  const row = version
    ? await db.eventType.findUnique({ where: { key_version: { key, version } } })
    : await db.eventType.findFirst({
        where: { key, status: "ACTIVE" },
        orderBy: { version: "desc" },
      });

  if (!row || row.status !== "ACTIVE") {
    return null;
  }

  const definition = toEventTypeDefinition({
    key: row.key,
    version: row.version,
    schema: row.schema,
    defaultPriority: row.defaultPriority,
    allowedChannels: row.allowedChannels,
    allowedSources: row.allowedSources,
    dedupeWindowSeconds: row.dedupeWindowSeconds,
    policy: row.policy,
  });

  eventTypeCache.set(cacheKey, {
    definition,
    expiresAt: Date.now() + EVENT_TYPE_CACHE_TTL_MS,
  });

  return definition;
};

export const listEventTypes = async (db: Db) =>
  db.eventType.findMany({ orderBy: [{ key: "asc" }, { version: "desc" }] });

export const createEventType = async (db: Db, input: CreateEventType) => {
  clearEventTypeCache();
  return db.eventType.create({
    data: {
      id: newId(),
      key: input.key,
      schema: input.schema as Prisma.InputJsonValue,
      defaultPriority: priorityToDb(input.default_priority as Priority),
      policy: input.policy as Prisma.InputJsonValue,
      allowedChannels: input.allowed_channels.map((channel) => channelToDb(channel as Channel)),
      allowedSources: input.allowed_sources.map((source) => sourceToDb(source as Source)),
      dedupeWindowSeconds: input.dedupe_window_seconds,
      version: input.version,
    },
  });
};

export const updateEventType = async (db: Db, key: string, input: UpdateEventType) => {
  clearEventTypeCache();
  const existing = await db.eventType.findFirst({
    where: { key },
    orderBy: { version: "desc" },
  });

  if (!existing) {
    throw new AppError("not_found", "Event type not found", 404);
  }

  const data: Prisma.EventTypeUpdateInput = {};

  if (input.schema) {
    data.schema = input.schema as Prisma.InputJsonValue;
  }

  if (input.default_priority) {
    data.defaultPriority = priorityToDb(input.default_priority);
  }

  if (input.allowed_channels) {
    data.allowedChannels = input.allowed_channels.map(channelToDb);
  }

  if (input.allowed_sources) {
    data.allowedSources = input.allowed_sources.map(sourceToDb);
  }

  if (input.dedupe_window_seconds) {
    data.dedupeWindowSeconds = input.dedupe_window_seconds;
  }

  if (input.policy) {
    data.policy = input.policy as Prisma.InputJsonValue;
  }

  if (input.status) {
    data.status = eventTypeStatusToDb(input.status);
  }

  return db.eventType.update({ where: { id: existing.id }, data });
};

export const getTemplateWithVersion = async (db: Db, id: string) =>
  db.template.findUnique({
    where: { id },
    include: { currentVersion: true, versions: { orderBy: { version: "desc" } } },
  });

export const listTemplates = async (db: Db) =>
  db.template.findMany({
    include: { currentVersion: true },
    orderBy: [{ key: "asc" }, { channel: "asc" }, { locale: "asc" }],
  });

const queryTemplates = async (
  db: Db,
  key: string,
  channel: Channel,
  locales: readonly string[],
) =>
  db.template.findMany({
    where: {
      key,
      channel: channelToDb(channel),
      locale: { in: [...locales] },
      status: "PUBLISHED",
      currentVersionId: { not: null },
    },
    include: { currentVersion: true },
  });

type TemplateRows = Awaited<ReturnType<typeof queryTemplates>>;

const templateCache = new Map<string, { rows: TemplateRows; expiresAt: number }>();
const TEMPLATE_CACHE_TTL_MS = 5_000;

export const clearTemplateCache = (): void => {
  templateCache.clear();
};

export const findTemplateForRecipient = async (
  db: Db,
  key: string,
  channel: Channel,
  locales: readonly string[],
): Promise<TemplateRows> => {
  const cacheKey = `${key}:${channel}:${locales.join(",")}`;
  const cached = templateCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.rows;
  }

  const rows = await queryTemplates(db, key, channel, locales);

  templateCache.set(cacheKey, { rows, expiresAt: Date.now() + TEMPLATE_CACHE_TTL_MS });

  return rows;
};

export const createTemplate = async (db: Db, input: CreateTemplate) =>
  db.template.create({
    data: {
      id: newId(),
      key: input.key,
      channel: channelToDb(input.channel),
      locale: input.locale.toLowerCase(),
      name: input.name,
    },
  });

export const createTemplateVersion = async (
  db: Db,
  templateId: string,
  input: CreateTemplateVersion,
  createdBy: string,
) => {
  const template = await db.template.findUnique({ where: { id: templateId } });

  if (!template) {
    throw new AppError("not_found", "Template not found", 404);
  }

  const latest = await db.templateVersion.findFirst({
    where: { templateId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  return db.templateVersion.create({
    data: {
      id: newId(),
      templateId,
      version: (latest?.version ?? 0) + 1,
      subject: input.subject,
      html: input.html,
      text: input.text,
      variablesSchema: input.variables_schema as Prisma.InputJsonValue,
      createdBy,
    },
  });
};

export const publishTemplateVersion = async (db: Db, templateId: string, versionId: string) => {
  const version = await db.templateVersion.findFirst({
    where: { id: versionId, templateId },
  });

  if (!version) {
    throw new AppError("not_found", "Template version not found", 404);
  }

  return db.$transaction(async (tx) => {
    await tx.templateVersion.update({
      where: { id: versionId },
      data: { publishedAt: new Date() },
    });

    return tx.template.update({
      where: { id: templateId },
      data: { currentVersionId: versionId, status: "PUBLISHED" },
      include: { currentVersion: true },
    });
  });
};
