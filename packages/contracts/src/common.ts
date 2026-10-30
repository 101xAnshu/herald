import { z } from "zod";

export const UuidSchema = z.uuid();
export const TimestampSchema = z.iso.datetime({ offset: true });

export const PaginationQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const PaginationMetaSchema = z.object({
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
});

export const ValidationIssueSchema = z.object({
  field: z.string(),
  code: z.string(),
  message: z.string(),
  index: z.number().int().nonnegative().optional(),
});

export const ErrorCodeSchema = z.enum([
  "invalid_request",
  "unauthorized",
  "forbidden",
  "not_found",
  "idempotency_conflict",
  "source_paused",
  "validation_failed",
  "unknown_recipient",
  "rate_limited",
  "internal_error",
  "dependency_unavailable",
]);

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    errors: z.array(ValidationIssueSchema).optional(),
  }),
  trace_id: z.string(),
});

export const successEnvelope = <T extends z.ZodType>(data: T) =>
  z.object({
    data,
    meta: PaginationMetaSchema.optional(),
    trace_id: z.string(),
  });

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
