import type { ErrorClass } from "@herald/contracts";

export interface ProviderFailure {
  status?: number;
  code?: string;
  bodyWritten?: boolean;
  acceptedWithoutId?: boolean;
  timedOut?: boolean;
}

const codeMatches = (code: string | undefined, candidates: readonly string[]): boolean =>
  code !== undefined && candidates.includes(code.toLowerCase());

const INVALID_RECIPIENT_CODES = [
  "invalid_recipient",
  "invalid_email",
  "invalid_phone",
  "invalid_token",
  "hard_bounce",
  "unsubscribed",
] as const;

const SUPPRESSED_CODES = ["suppressed", "opt_out", "do_not_contact", "blocked"] as const;

const AUTH_CODES = ["unauthorized", "forbidden", "invalid_api_key", "auth_failed"] as const;

const RATE_LIMIT_CODES = ["rate_limit", "rate_limited", "quota_exceeded", "too_many_requests"] as const;

export const classifyProviderError = (failure: ProviderFailure): ErrorClass => {
  if (codeMatches(failure.code, SUPPRESSED_CODES)) {
    return "suppressed";
  }

  if (codeMatches(failure.code, INVALID_RECIPIENT_CODES)) {
    return "invalid_recipient";
  }

  if (codeMatches(failure.code, AUTH_CODES) || failure.status === 401 || failure.status === 403) {
    return "auth";
  }

  if (
    codeMatches(failure.code, RATE_LIMIT_CODES) ||
    failure.status === 429 ||
    codeMatches(failure.code, ["insufficient_quota"])
  ) {
    return "rate_limit";
  }

  if (
    failure.acceptedWithoutId ||
    (failure.timedOut && failure.bodyWritten) ||
    codeMatches(failure.code, ["timeout_after_body", "ambiguous", "write_aborted"])
  ) {
    return "unknown";
  }

  if (failure.status === 400 || failure.status === 404 || failure.status === 409 || failure.status === 422) {
    return "permanent";
  }

  if (
    failure.status === 500 ||
    failure.status === 502 ||
    failure.status === 503 ||
    failure.status === 504 ||
    failure.status === 408
  ) {
    return "transient";
  }

  if (codeMatches(failure.code, ["econnreset", "etimedout", "econnrefused", "enotfound"])) {
    return failure.bodyWritten ? "unknown" : "transient";
  }

  return "transient";
};

export const isRetryableClass = (errorClass: ErrorClass): boolean =>
  errorClass === "transient" || errorClass === "rate_limit";
