import type { CreateEventType, UpdateEventType } from "@herald/contracts";
import { AppError } from "@herald/core";
import {
  channelFromDb,
  createEventType,
  eventTypeStatusFromDb,
  listEventTypes,
  priorityFromDb,
  prisma,
  sourceFromDb,
  updateEventType,
} from "@herald/db";

export const eventTypeView = (row: {
  id: string;
  key: string;
  schema: unknown;
  defaultPriority: string;
  policy: unknown;
  allowedChannels: string[];
  allowedSources: string[];
  dedupeWindowSeconds: number;
  status: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: row.id,
  key: row.key,
  schema: row.schema,
  default_priority: priorityFromDb(row.defaultPriority as never),
  policy: row.policy,
  allowed_channels: row.allowedChannels.map((channel) => channelFromDb(channel as never)),
  allowed_sources: row.allowedSources.map((source) => sourceFromDb(source as never)),
  dedupe_window_seconds: row.dedupeWindowSeconds,
  status: eventTypeStatusFromDb(row.status as never),
  version: row.version,
  created_at: row.createdAt.toISOString(),
  updated_at: row.updatedAt.toISOString(),
});

export const listCatalogEventTypes = async () => {
  const rows = await listEventTypes(prisma);
  return rows.map(eventTypeView);
};

export const getCatalogEventType = async (key: string) => {
  const row = await prisma.eventType.findFirst({
    where: { key },
    orderBy: { version: "desc" },
  });

  if (!row) {
    throw new AppError("not_found", "Event type not found", 404);
  }

  return eventTypeView(row);
};

export const addEventType = async (input: CreateEventType) => {
  const row = await createEventType(prisma, input);
  return eventTypeView(row);
};

export const patchEventType = async (key: string, input: UpdateEventType) => {
  const row = await updateEventType(prisma, key, input);
  return eventTypeView(row);
};
