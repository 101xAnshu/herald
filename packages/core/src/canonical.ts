export const stableStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();

  const normalize = (input: unknown): unknown => {
    if (input === undefined) {
      return null;
    }

    if (input === null || typeof input !== "object") {
      return input;
    }

    if (input instanceof Date) {
      return input.toISOString();
    }

    if (Array.isArray(input)) {
      return input.map(normalize);
    }

    if (seen.has(input)) {
      throw new TypeError("Cannot stringify a circular structure");
    }

    seen.add(input);

    const record = input as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};

    for (const key of Object.keys(record).sort()) {
      sorted[key] = normalize(record[key]);
    }

    seen.delete(input);
    return sorted;
  };

  return JSON.stringify(normalize(value));
};
