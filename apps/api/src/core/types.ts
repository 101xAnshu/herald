/* eslint-disable @typescript-eslint/no-namespace */
import type { Source, Scope, ValidationIssue } from "@herald/contracts";

export interface ApiClientContext {
  id: string;
  source: Source;
  scopes: Scope[];
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      traceId: string;
      apiClient?: ApiClientContext;
      userId?: string;
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export interface ErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  errors?: ValidationIssue[];
}
