import type { UserKind } from "@herald/contracts";
import type { AudienceFilter } from "@herald/contracts";

export interface AudienceUser {
  id: string;
  kind: UserKind;
  city: string | null;
  lastBookingAt: Date | null;
  marketingOptIn: boolean;
}

export const matchesAudience = (user: AudienceUser, filter: AudienceFilter, now = new Date()): boolean => {
  if (filter.user_ids && !filter.user_ids.includes(user.id)) {
    return false;
  }

  if (filter.kinds && !filter.kinds.includes(user.kind)) {
    return false;
  }

  if (filter.city && user.city !== filter.city) {
    return false;
  }

  if (filter.marketing_opt_in !== undefined && user.marketingOptIn !== filter.marketing_opt_in) {
    return false;
  }

  if (filter.inactive_days !== undefined) {
    if (!user.lastBookingAt) {
      return false;
    }

    const inactiveMs = now.getTime() - user.lastBookingAt.getTime();
    const inactiveDays = inactiveMs / 86_400_000;

    if (inactiveDays < filter.inactive_days) {
      return false;
    }
  }

  return true;
};

export const audienceFingerprint = (filter: AudienceFilter): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(filter)
        .filter(([, value]) => value !== undefined)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
