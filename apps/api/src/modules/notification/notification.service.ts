import type { NotificationListQuery, NotificationStatus, Source } from "@herald/contracts";
import { AppError } from "@herald/core";
import {
  cancelNotification,
  deliveriesForNotification,
  getNotification,
  getNotificationTrace,
  listNotifications,
  notificationToView,
  retryNotification,
} from "@herald/db";

export const encodeCursor = (createdAt: Date, id: string): string =>
  Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString("base64url");

const decodeCursor = (cursor: string): { createdAt: Date; id: string } => {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      createdAt?: string;
      id?: string;
    };

    if (!parsed.createdAt || !parsed.id) {
      throw new Error("missing fields");
    }

    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
  } catch {
    throw new AppError("validation_failed", "Cursor is invalid", 422);
  }
};

export const listNotificationPage = async (query: NotificationListQuery) => {
  const rows = await listNotifications({
    source: query.source as Source | undefined,
    status: query.status as NotificationStatus | undefined,
    userId: query.user_id,
    since: query.since ? new Date(query.since) : undefined,
    cursor: query.cursor ? decodeCursor(query.cursor) : undefined,
    limit: query.limit,
  });

  const page = rows.slice(0, query.limit);
  const hasMore = rows.length > query.limit;
  const last = page[page.length - 1];

  return {
    items: page.map(notificationToView),
    meta: {
      next_cursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
      has_more: hasMore,
    },
  };
};

export const notificationDetail = (id: string) => getNotification(id);
export const notificationTrace = (id: string) => getNotificationTrace(id);
export const notificationDeliveries = (id: string) => deliveriesForNotification(id);
export const cancel = (id: string) => cancelNotification(id);
export const retry = (id: string) => retryNotification(id);
