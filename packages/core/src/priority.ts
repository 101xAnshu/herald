import type { Priority } from "@herald/contracts";

export type PriorityResult =
  | { ok: true; priority: Priority }
  | { ok: false; code: "priority_override_not_allowed" };

export const resolvePriority = (
  defaultPriority: Priority,
  override: Priority | undefined,
  allowed: boolean,
): PriorityResult => {
  if (!override) {
    return { ok: true, priority: defaultPriority };
  }

  if (!allowed) {
    return { ok: false, code: "priority_override_not_allowed" };
  }

  return { ok: true, priority: override };
};

export const isCritical = (priority: Priority): boolean => priority === "critical";
