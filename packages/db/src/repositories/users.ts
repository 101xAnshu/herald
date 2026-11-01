import type { Channel, PreferenceEntry, Source, Unsubscribe } from "@herald/contracts";
import { AppError, hashAddress, newId, type PolicyUser } from "@herald/core";
import { loadSuppressionIndex } from "./suppressions";
import type { Db } from "../prisma";
import {
  channelFromDb,
  channelToDb,
  sourceFromDb,
  sourceToDb,
  userKindFromDb,
  userStatusFromDb,
} from "../mappers";

export const resolveUser = async (db: Db, userId: string) =>
  db.user.findUnique({ where: { id: userId } });

export const resolveUserByExternalId = async (db: Db, externalId: string) =>
  db.user.findUnique({ where: { externalId } });

export const loadPolicyUser = async (
  db: Db,
  userId: string,
  pepper: string,
): Promise<PolicyUser | null> => {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      preferences: true,
      settings: true,
      devices: { where: { status: "ACTIVE" } },
    },
  });

  if (!user) {
    return null;
  }

  const hashes = [
    user.email ? hashAddress(user.email, pepper) : null,
    user.phone ? hashAddress(user.phone, pepper) : null,
    ...user.devices.map((device) => device.tokenHash),
  ].filter((value): value is string => Boolean(value));

  const suppressionIndex = hashes.length > 0 ? await loadSuppressionIndex(db) : new Map();
  const suppressedChannels = [
    ...new Set(
      hashes
        .map((hash) => suppressionIndex.get(hash)?.channel)
        .filter((channel): channel is Channel => Boolean(channel)),
    ),
  ];

  return {
    id: user.id,
    kind: userKindFromDb(user.kind),
    status: userStatusFromDb(user.status),
    locale: user.locale,
    timezone: user.timezone,
    email: user.email,
    phone: user.phone,
    preferences: user.preferences.map((preference) => ({
      category: preference.category,
      channel: channelFromDb(preference.channel),
      enabled: preference.enabled,
    })),
    quietStart: user.settings?.quietStart ?? null,
    quietEnd: user.settings?.quietEnd ?? null,
    marketingPaused: user.settings?.marketingPaused ?? false,
    activeDeviceChannels: user.devices.length > 0 ? (["push"] as Channel[]) : ([] as Channel[]),
    suppressedChannels,
  };
};

export const getPreferences = async (db: Db, userId: string) => {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { preferences: true, settings: true },
  });

  if (!user) {
    throw new AppError("not_found", "User not found", 404);
  }

  return {
    userId: user.id,
    locale: user.locale,
    timezone: user.timezone,
    preferences: user.preferences.map(
      (preference): PreferenceEntry => ({
        category: preference.category,
        channel: channelFromDb(preference.channel),
        enabled: preference.enabled,
        source: sourceFromDb(preference.source),
      }),
    ),
  };
};

export const updatePreferences = async (
  db: Db,
  userId: string,
  preferences: readonly { category: string; channel: Channel; enabled: boolean }[],
  source: Source,
) => {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });

  if (!user) {
    throw new AppError("not_found", "User not found", 404);
  }

  await db.$transaction(
    preferences.map((preference) =>
      db.preference.upsert({
        where: {
          userId_category_channel: {
            userId,
            category: preference.category,
            channel: channelToDb(preference.channel),
          },
        },
        create: {
          userId,
          category: preference.category,
          channel: channelToDb(preference.channel),
          enabled: preference.enabled,
          source: sourceToDb(source),
        },
        update: { enabled: preference.enabled, source: sourceToDb(source) },
      }),
    ),
  );

  return getPreferences(db, userId);
};

export const setQuietHours = async (
  db: Db,
  userId: string,
  quiet: { start: string; end: string; timezone: string },
) => {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });

  if (!user) {
    throw new AppError("not_found", "User not found", 404);
  }

  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { timezone: quiet.timezone } }),
    db.userSettings.upsert({
      where: { userId },
      create: { userId, quietStart: quiet.start, quietEnd: quiet.end },
      update: { quietStart: quiet.start, quietEnd: quiet.end },
    }),
  ]);
};

export const recordUnsubscribe = async (
  db: Db,
  userId: string,
  input: Unsubscribe,
  source: Source,
) => {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } });

  if (!user) {
    throw new AppError("not_found", "User not found", 404);
  }

  await db.$transaction([
    db.preference.upsert({
      where: {
        userId_category_channel: {
          userId,
          category: input.category,
          channel: channelToDb(input.channel),
        },
      },
      create: {
        userId,
        category: input.category,
        channel: channelToDb(input.channel),
        enabled: false,
        source: sourceToDb(source),
      },
      update: { enabled: false, source: sourceToDb(source) },
    }),
    db.consentEvent.create({
      data: {
        id: newId(),
        userId,
        category: input.category,
        channel: channelToDb(input.channel),
        action: "REVOKED",
        source: sourceToDb(source),
      },
    }),
  ]);
};

export const listInbox = async (
  db: Db,
  userId: string,
  options: { limit: number; beforeSequence?: bigint; unreadOnly?: boolean },
) => {
  const items = await db.inboxItem.findMany({
    where: {
      userId,
      ...(options.unreadOnly ? { readAt: null } : {}),
      ...(options.beforeSequence ? { sequence: { lt: options.beforeSequence } } : {}),
    },
    orderBy: { sequence: "desc" },
    take: options.limit + 1,
  });

  const hasMore = items.length > options.limit;
  return { items: items.slice(0, options.limit), hasMore };
};

export const getInboxItem = async (db: Db, userId: string, itemId: string) =>
  db.inboxItem.findFirst({ where: { id: itemId, userId } });

export const markInboxRead = async (db: Db, userId: string, itemId: string) => {
  const item = await db.inboxItem.findFirst({ where: { id: itemId, userId } });

  if (!item) {
    throw new AppError("not_found", "Inbox item not found", 404);
  }

  return db.inboxItem.update({
    where: { id: itemId },
    data: { readAt: item.readAt ?? new Date() },
  });
};

export const markAllInboxRead = async (db: Db, userId: string) => {
  const result = await db.inboxItem.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });

  return result.count;
};
