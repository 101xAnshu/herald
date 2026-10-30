export type TransitionResult<Status extends string> =
  | { ok: true; status: Status; changed: boolean }
  | { ok: false; code: "invalid_transition"; from: Status; to: Status };

export const applyTransition = <Status extends string>(
  transitions: Record<Status, readonly Status[]>,
  current: Status,
  next: Status,
): TransitionResult<Status> => {
  if (current === next) {
    return { ok: true, status: current, changed: false };
  }

  if (!transitions[current].includes(next)) {
    return { ok: false, code: "invalid_transition", from: current, to: next };
  }

  return { ok: true, status: next, changed: true };
};
