export interface QuietHoursWindow {
  start: string;
  end: string;
  timezone: string;
}

interface LocalTime {
  hour: number;
  minute: number;
}

const MINUTE_MS = 60_000;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const cached = formatterCache.get(timeZone);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  formatterCache.set(timeZone, formatter);
  return formatter;
};

export const parseTimeOfDay = (value: string): number => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);

  if (!match) {
    throw new RangeError(`Invalid time of day: ${value}`);
  }

  return Number(match[1]) * 60 + Number(match[2]);
};

export const isValidTimezone = (timezone: string): boolean => {
  try {
    formatterFor(timezone).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const localTime = (date: Date, timezone: string): LocalTime => {
  const parts = formatterFor(timezone).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");

  return { hour: hour === 24 ? 0 : hour, minute };
};

export const isQuietHours = (now: Date, window: QuietHoursWindow): boolean => {
  const start = parseTimeOfDay(window.start);
  const end = parseTimeOfDay(window.end);

  if (start === end) {
    return false;
  }

  const local = localTime(now, window.timezone);
  const current = local.hour * 60 + local.minute;

  if (start < end) {
    return current >= start && current < end;
  }

  return current >= start || current < end;
};

export const nextQuietHoursEnd = (now: Date, window: QuietHoursWindow): Date => {
  if (!isQuietHours(now, window)) {
    return now;
  }

  const limit = now.getTime() + 48 * 60 * MINUTE_MS;

  for (let cursor = now.getTime() + MINUTE_MS; cursor <= limit; cursor += MINUTE_MS) {
    const candidate = new Date(cursor);

    if (!isQuietHours(candidate, window)) {
      return candidate;
    }
  }

  return now;
};

export const nextLocalMidnight = (now: Date, timezone: string): Date => {
  const limit = now.getTime() + 26 * 60 * MINUTE_MS;

  for (let cursor = now.getTime() + MINUTE_MS; cursor <= limit; cursor += MINUTE_MS) {
    const candidate = new Date(cursor);
    const local = localTime(candidate, timezone);

    if (local.hour === 0 && local.minute === 0) {
      return candidate;
    }
  }

  return new Date(now.getTime() + 24 * 60 * MINUTE_MS);
};
