import { z } from "zod";

import {
  CampaignRecipientStatusSchema,
  CampaignStatusSchema,
  ChannelSchema,
  DeliveryStatusSchema,
  NotificationStatusSchema,
  PrioritySchema,
  ScopeSchema,
  SourceSchema,
  UserKindSchema,
} from "./enums";
import { PaginationQuerySchema, TimestampSchema, UuidSchema } from "./common";
import {
  AcceptedEventSchema,
  IngestEventSchema,
  RecipientSchema,
} from "./event";

const booleanQuery = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === "true"));

export const NotificationListQuerySchema = PaginationQuerySchema.extend({
  source: SourceSchema.optional(),
  status: NotificationStatusSchema.optional(),
  user_id: UuidSchema.optional(),
  since: TimestampSchema.optional(),
});

export const InboxQuerySchema = PaginationQuerySchema.extend({
  unread: booleanQuery,
});

export const NotificationSchema = z.object({
  id: UuidSchema,
  user_id: UuidSchema,
  source: SourceSchema,
  event_type: z.string(),
  event_version: z.number().int(),
  priority: PrioritySchema,
  status: NotificationStatusSchema,
  idempotency_key: z.string(),
  scheduled_for: TimestampSchema.nullable(),
  trace_id: z.string(),
  created_at: TimestampSchema,
});

export const DeliverySchema = z.object({
  id: UuidSchema,
  notification_id: UuidSchema,
  channel: ChannelSchema,
  priority: PrioritySchema,
  status: DeliveryStatusSchema,
  provider: z.string(),
  provider_message_id: z.string().nullable(),
  attempt_count: z.number().int(),
  next_attempt_at: TimestampSchema.nullable(),
  accepted_at: TimestampSchema.nullable(),
  delivered_at: TimestampSchema.nullable(),
  failed_at: TimestampSchema.nullable(),
});

export const TraceEntrySchema = z.object({
  at: TimestampSchema,
  kind: z.string(),
  channel: ChannelSchema.nullable(),
  status: DeliveryStatusSchema.nullable(),
  attempt: z.number().int().nullable(),
  detail: z.record(z.string(), z.unknown()),
});

export const NotificationTraceSchema = z.object({
  notification: NotificationSchema,
  deliveries: z.array(DeliverySchema),
  timeline: z.array(TraceEntrySchema),
});

export const PreferenceEntrySchema = z.object({
  category: z.string(),
  channel: ChannelSchema,
  enabled: z.boolean(),
  source: SourceSchema,
});

export const PreferencesResponseSchema = z.object({
  user_id: UuidSchema,
  locale: z.string(),
  timezone: z.string(),
  preferences: z.array(PreferenceEntrySchema),
});

export const UpdatePreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        category: z.string().min(1).max(50),
        channel: ChannelSchema,
        enabled: z.boolean(),
      }),
    )
    .min(1),
});

const TimeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM");

const TimezoneSchema = z.string().min(1).refine(
  (value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
      return true;
    } catch {
      return false;
    }
  },
  { message: "must be a valid IANA timezone" },
);

export const QuietHoursSchema = z
  .object({
    start: TimeOfDaySchema,
    end: TimeOfDaySchema,
    timezone: TimezoneSchema,
  })
  .refine((value) => value.start !== value.end, {
    message: "start and end must differ",
    path: ["end"],
  });

export const UnsubscribeSchema = z.object({
  category: z.string().min(1).max(50),
  channel: ChannelSchema,
  reason: z.string().max(500).optional(),
});

export const DemoTokenSchema = z.object({
  external_id: z.string().min(1).max(200),
});

export const DemoTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int(),
  user_id: UuidSchema,
  external_id: z.string(),
});

export const InboxItemSchema = z.object({
  id: UuidSchema,
  notification_id: UuidSchema,
  source: SourceSchema,
  title: z.string(),
  body: z.string(),
  deep_link: z.string().nullable(),
  read_at: TimestampSchema.nullable(),
  created_at: TimestampSchema,
  expires_at: TimestampSchema.nullable(),
});

export const InboxItemDetailSchema = InboxItemSchema.extend({
  metadata: z.record(z.string(), z.unknown()),
});

export const AudienceFilterSchema = z
  .object({
    kinds: z.array(UserKindSchema).min(1).optional(),
    city: z.string().min(1).max(100).optional(),
    inactive_days: z.number().int().min(1).max(3650).optional(),
    marketing_opt_in: z.boolean().optional(),
    user_ids: z.array(UuidSchema).max(1000).optional(),
  })
  .strict();

export const CampaignCreateSchema = z
  .object({
    name: z.string().min(1).max(200),
    template_id: UuidSchema,
    channel: ChannelSchema,
    audience: AudienceFilterSchema,
    scheduled_for: TimestampSchema.nullable().optional(),
    rate_limit: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

export const CampaignSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  template_id: UuidSchema,
  channel: ChannelSchema,
  audience: AudienceFilterSchema,
  scheduled_for: TimestampSchema.nullable(),
  rate_limit: z.number().int(),
  status: CampaignStatusSchema,
  created_by: z.string(),
  started_at: TimestampSchema.nullable(),
  completed_at: TimestampSchema.nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});

export const CampaignStatsSchema = z.object({
  campaign_id: UuidSchema,
  status: CampaignStatusSchema,
  total: z.number().int(),
  pending: z.number().int(),
  queued: z.number().int(),
  sent: z.number().int(),
  delivered: z.number().int(),
  failed: z.number().int(),
  suppressed: z.number().int(),
  canceled: z.number().int(),
  progress_ratio: z.number(),
});

export const CampaignRecipientSchema = z.object({
  campaign_id: UuidSchema,
  user_id: UuidSchema,
  shard: z.number().int(),
  status: CampaignRecipientStatusSchema,
  notification_id: UuidSchema.nullable(),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});

export const CampaignRecipientsQuerySchema = PaginationQuerySchema.extend({
  status: CampaignRecipientStatusSchema.optional(),
});

export const CreateEventTypeSchema = z.object({
  key: z.string().min(1).max(100),
  schema: z.record(z.string(), z.unknown()).default({}),
  default_priority: PrioritySchema,
  allowed_channels: z.array(ChannelSchema).min(1),
  allowed_sources: z.array(SourceSchema).min(1),
  dedupe_window_seconds: z.number().int().min(1),
  policy: z.record(z.string(), z.unknown()).default({}),
  version: z.number().int().min(1).default(1),
});

export const UpdateEventTypeSchema = z.object({
  schema: z.record(z.string(), z.unknown()).optional(),
  default_priority: PrioritySchema.optional(),
  allowed_channels: z.array(ChannelSchema).min(1).optional(),
  allowed_sources: z.array(SourceSchema).min(1).optional(),
  dedupe_window_seconds: z.number().int().min(1).optional(),
  policy: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

export const CreateTemplateSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/, "must be lowercase with underscores"),
  channel: ChannelSchema,
  locale: z.string().min(2).max(20),
  name: z.string().min(1).max(200),
});

export const CreateTemplateVersionSchema = z.object({
  subject: z.string().max(200).optional(),
  html: z.string().min(1).max(512_000),
  text: z.string().min(1).max(64_000),
  variables_schema: z.record(z.string(), z.unknown()).default({}),
});

export const PublishTemplateSchema = z.object({
  version_id: UuidSchema,
});

export const TemplatePreviewSchema = z.object({
  version_id: UuidSchema.optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});

export const FaultInjectionSchema = z.object({
  channel: ChannelSchema,
  outcome: z.enum(["accept", "fail", "timeout", "rate_limit"]),
  ttl_seconds: z.number().int().min(1).max(3600).default(60),
});

export const SourcePauseSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const DlqReplaySchema = z.object({
  dry_run: z.boolean().default(true),
});

export const DlqDiscardSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const WebhookEventSchema = z.object({
  event_id: z.string().min(1).max(200),
  type: z.enum(["delivered", "failed", "bounced"]),
  provider_message_id: z.string().min(1).max(200),
  delivery_id: UuidSchema.optional(),
  occurred_at: TimestampSchema,
  error_class: z.string().optional(),
  error_code: z.string().optional(),
});

export const ApiKeyCreateSchema = z.object({
  name: z.string().min(1).max(200),
  source: SourceSchema,
  scopes: z.array(ScopeSchema).min(1),
  expires_in_days: z.number().int().min(1).max(3650).default(365),
});

export const ApiKeyRotateSchema = z.object({
  overlap_seconds: z.number().int().min(60).max(86_400).default(3600),
});

export const EventSubmissionSchema = IngestEventSchema;
export const EventAcceptedSchema = AcceptedEventSchema;
export const RecipientRefSchema = RecipientSchema;

export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;
export type InboxQuery = z.infer<typeof InboxQuerySchema>;
export type NotificationView = z.infer<typeof NotificationSchema>;
export type DeliveryView = z.infer<typeof DeliverySchema>;
export type TraceEntry = z.infer<typeof TraceEntrySchema>;
export type NotificationTrace = z.infer<typeof NotificationTraceSchema>;
export type PreferenceEntry = z.infer<typeof PreferenceEntrySchema>;
export type PreferencesResponse = z.infer<typeof PreferencesResponseSchema>;
export type UpdatePreferences = z.infer<typeof UpdatePreferencesSchema>;
export type QuietHours = z.infer<typeof QuietHoursSchema>;
export type Unsubscribe = z.infer<typeof UnsubscribeSchema>;
export type DemoToken = z.infer<typeof DemoTokenSchema>;
export type DemoTokenResponse = z.infer<typeof DemoTokenResponseSchema>;
export type InboxItemView = z.infer<typeof InboxItemSchema>;
export type InboxItemDetailView = z.infer<typeof InboxItemDetailSchema>;
export type AudienceFilter = z.infer<typeof AudienceFilterSchema>;
export type CampaignCreate = z.infer<typeof CampaignCreateSchema>;
export type CampaignView = z.infer<typeof CampaignSchema>;
export type CampaignStats = z.infer<typeof CampaignStatsSchema>;
export type CampaignRecipientView = z.infer<typeof CampaignRecipientSchema>;
export type CreateEventType = z.infer<typeof CreateEventTypeSchema>;
export type UpdateEventType = z.infer<typeof UpdateEventTypeSchema>;
export type CreateTemplate = z.infer<typeof CreateTemplateSchema>;
export type CreateTemplateVersion = z.infer<typeof CreateTemplateVersionSchema>;
export type TemplatePreview = z.infer<typeof TemplatePreviewSchema>;
export type FaultInjection = z.infer<typeof FaultInjectionSchema>;
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;
export type ApiKeyCreate = z.infer<typeof ApiKeyCreateSchema>;
export type ApiKeyRotate = z.infer<typeof ApiKeyRotateSchema>;
