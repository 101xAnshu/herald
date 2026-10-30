import { z } from "zod";

import { ChannelSchema, PrioritySchema, SourceSchema } from "./enums";
import { TimestampSchema, UuidSchema } from "./common";

export const EventTypeKeySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/, "must look like booking.confirmed");

export const RecipientSchema = z
  .object({
    external_id: z.string().min(1).max(200),
  })
  .strict();

export const IngestEventSchema = z
  .object({
    type: EventTypeKeySchema,
    schema_version: z.number().int().min(1),
    recipient: RecipientSchema,
    idempotency_key: z.string().min(1).max(255),
    data: z.record(z.string(), z.unknown()).default({}),
    priority: PrioritySchema.optional(),
  })
  .strict();

export const IngestBatchSchema = z
  .object({
    events: z.array(z.unknown()).min(1).max(1000),
  })
  .strict();

export const AcceptedEventSchema = z.object({
  notification_id: UuidSchema,
  status: z.literal("accepted"),
  trace_id: z.string(),
});

export const BatchItemResultSchema = z.discriminatedUnion("status", [
  z.object({
    index: z.number().int().nonnegative(),
    status: z.literal("accepted"),
    notification_id: UuidSchema,
  }),
  z.object({
    index: z.number().int().nonnegative(),
    status: z.literal("rejected"),
    code: z.string(),
    message: z.string(),
    field: z.string().optional(),
  }),
]);

export const BatchAcceptedSchema = z.object({
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  results: z.array(BatchItemResultSchema),
  trace_id: z.string(),
});

export const EventEnvelopeSchema = z.object({
  notification_id: UuidSchema,
  user_id: UuidSchema,
  source: SourceSchema,
  type: z.string(),
  schema_version: z.number().int().min(1),
  priority: PrioritySchema,
  idempotency_key: z.string(),
  data: z.record(z.string(), z.unknown()),
  trace_id: z.string(),
  shard: z.number().int().nonnegative(),
  created_at: TimestampSchema,
});

export const DeliveryMessageSchema = z.object({
  delivery_id: UuidSchema,
  notification_id: UuidSchema,
  user_id: UuidSchema,
  channel: ChannelSchema,
  priority: PrioritySchema,
  source: SourceSchema,
  trace_id: z.string(),
  shard: z.number().int().nonnegative(),
  next_attempt_at: TimestampSchema.optional(),
});

export const EventTypePolicySchema = z.object({
  category: z.string().min(1),
  quiet_hours_bypass: z.boolean().default(false),
  allow_priority_override: z.boolean().default(false),
  marketing: z.boolean().default(false),
  caps: z.partialRecord(ChannelSchema, z.number().int().positive()).optional(),
  cap_action: z.enum(["defer", "suppress"]).default("defer"),
  locale_template: z.string().optional(),
});

export const EventTypeDefinitionSchema = z.object({
  key: EventTypeKeySchema,
  schema_version: z.number().int().min(1),
  default_priority: PrioritySchema,
  allowed_channels: z.array(ChannelSchema).min(1),
  allowed_sources: z.array(SourceSchema).min(1),
  dedupe_window_seconds: z.number().int().positive(),
  policy: EventTypePolicySchema,
});

export const EventCatalogSchema = z.array(EventTypeDefinitionSchema).min(1);

export type Recipient = z.infer<typeof RecipientSchema>;
export type IngestEvent = z.infer<typeof IngestEventSchema>;
export type IngestBatch = z.infer<typeof IngestBatchSchema>;
export type AcceptedEvent = z.infer<typeof AcceptedEventSchema>;
export type BatchItemResult = z.infer<typeof BatchItemResultSchema>;
export type BatchAccepted = z.infer<typeof BatchAcceptedSchema>;
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
export type DeliveryMessage = z.infer<typeof DeliveryMessageSchema>;
export type EventTypePolicy = z.infer<typeof EventTypePolicySchema>;
export type EventTypeDefinition = z.infer<typeof EventTypeDefinitionSchema>;
