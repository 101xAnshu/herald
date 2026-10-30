import type { ErrorCode, ValidationIssue } from "@herald/contracts";

export interface AppErrorOptions {
  details?: Record<string, unknown>;
  errors?: ValidationIssue[];
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: Record<string, unknown>;
  readonly errors?: ValidationIssue[];

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    options: AppErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = options.details;
    this.errors = options.errors;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
