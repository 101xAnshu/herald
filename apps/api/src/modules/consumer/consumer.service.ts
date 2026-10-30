import type { InboxItemView, PreferencesResponse, Unsubscribe } from "@herald/contracts";
import { AppError } from "@herald/core";
import { getPrismaForUser } from "@herald/db";
import {
  getInboxItem,
  getPreferences,
  listInbox,
  markAllInboxRead,
  markInboxRead,
  recordUnsubscribe,
  setQuietHours,
  updatePreferences,
} from "@herald/db";
import type { PreferencesResponse as PreferencesResponseContract } from "@herald/contracts";

const encodeSequence = (sequence: bigint): string =>
  Buffer.from(sequence.toString()).toString("base64url");

const decodeSequence = (cursor: string): bigint => {
  try {
    const value = Buffer.from(cursor, "base64url").toString("utf8");

    if (!/^\d+$/.test(value)) {
      throw new Error("invalid");
    }

    return BigInt(value);
  } catch {
    throw new AppError("validation_failed", "Cursor is invalid", 422);
  }
};

export const inboxView = (item: {
  id: string;
  notificationId: string;
  source: string;
  title: string;
  body: string;
  deepLink: string | null;
  readAt: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
  metadata: unknown;
  sequence: bigint;
}): InboxItemView & { sequence: string; metadata: unknown } => ({
  id: item.id,
  notification_id: item.notificationId,
  source: item.source.toLowerCase() as InboxItemView["source"],
  title: item.title,
  body: item.body,
  deep_link: item.deepLink,
  read_at: item.readAt?.toISOString() ?? null,
  created_at: item.createdAt.toISOString(),
  expires_at: item.expiresAt?.toISOString() ?? null,
  sequence: item.sequence.toString(),
  metadata: item.metadata,
});

export const inboxPage = async (
  userId: string,
  query: { limit: number; cursor?: string; unread?: boolean },
) => {
  const db = getPrismaForUser(userId);
  const page = await listInbox(db, userId, {
    limit: query.limit,
    beforeSequence: query.cursor ? decodeSequence(query.cursor) : undefined,
    unreadOnly: query.unread,
  });

  const last = page.items[page.items.length - 1];

  return {
    items: page.items.map(inboxView),
    meta: {
      next_cursor: page.hasMore && last ? encodeSequence(last.sequence) : null,
      has_more: page.hasMore,
    },
  };
};

export const inboxDetail = async (userId: string, itemId: string) => {
  const item = await getInboxItem(getPrismaForUser(userId), userId, itemId);

  if (!item) {
    throw new AppError("not_found", "Inbox item not found", 404);
  }

  return inboxView(item);
};

export const readOne = async (userId: string, itemId: string) =>
  inboxView(await markInboxRead(getPrismaForUser(userId), userId, itemId));

export const readAll = async (userId: string) => ({
  updated: await markAllInboxRead(getPrismaForUser(userId), userId),
});

export const preferences = async (userId: string): Promise<PreferencesResponse> => {
  const result = await getPreferences(getPrismaForUser(userId), userId);

  return {
    user_id: result.userId,
    locale: result.locale,
    timezone: result.timezone,
    preferences: result.preferences,
  };
};

export const updatePreferenceSet = async (
  userId: string,
  preferencesInput: PreferencesResponseContract["preferences"],
  source = "ops" as const,
) => {
  const result = await updatePreferences(
    getPrismaForUser(userId),
    userId,
    preferencesInput,
    source,
  );

  return {
    user_id: result.userId,
    locale: result.locale,
    timezone: result.timezone,
    preferences: result.preferences,
  };
};

export const quietHours = async (
  userId: string,
  input: { start: string; end: string; timezone: string },
) => {
  await setQuietHours(getPrismaForUser(userId), userId, input);
  return preferences(userId);
};

export const unsubscribe = async (userId: string, input: Unsubscribe) => {
  await recordUnsubscribe(getPrismaForUser(userId), userId, input, "ops");
  return { ok: true };
};
