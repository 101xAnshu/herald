import { z } from "zod";

export const SOURCES = ["booking", "payments", "security", "growth", "ops"] as const;
export const CHANNELS = ["email", "in_app", "push", "sms"] as const;
export const PRIORITIES = ["critical", "high", "normal", "low"] as const;

export const NOTIFICATION_STATUSES = [
  "accepted",
  "scheduled",
  "processing",
  "partially_delivered",
  "delivered",
  "failed",
  "canceled",
  "suppressed",
] as const;

export const DELIVERY_STATUSES = [
  "pending",
  "sending",
  "accepted",
  "delivered",
  "retry_scheduled",
  "unknown",
  "failed",
  "canceled",
  "suppressed",
] as const;

export const CAMPAIGN_STATUSES = [
  "draft",
  "scheduled",
  "running",
  "paused",
  "completed",
  "canceled",
  "failed",
] as const;

export const CAMPAIGN_RECIPIENT_STATUSES = [
  "pending",
  "queued",
  "sent",
  "delivered",
  "failed",
  "suppressed",
  "canceled",
] as const;

export const ERROR_CLASSES = [
  "permanent",
  "transient",
  "rate_limit",
  "unknown",
  "auth",
  "invalid_recipient",
  "suppressed",
] as const;

export const RETRY_STATES = ["pending", "claimed", "succeeded", "exhausted", "canceled"] as const;

export const SCOPES = [
  "events:write",
  "events:read",
  "notifications:manage",
  "campaigns:read",
  "campaigns:write",
  "ops:read",
  "ops:manage",
  "catalog:write",
  "keys:manage",
] as const;

export const API_CLIENT_KINDS = ["service", "operator"] as const;
export const USER_KINDS = ["customer", "pro", "ops"] as const;
export const USER_STATUSES = ["active", "disabled"] as const;
export const DEVICE_PLATFORMS = ["ios", "android", "web"] as const;
export const CONSENT_ACTIONS = ["granted", "revoked"] as const;
export const TEMPLATE_STATUSES = ["draft", "published", "archived"] as const;
export const EVENT_TYPE_STATUSES = ["active", "disabled"] as const;
export const OUTBOX_STATUSES = ["pending", "published", "failed"] as const;
export const AUDIT_RESULTS = ["success", "failure"] as const;

export const SourceSchema = z.enum(SOURCES);
export const ChannelSchema = z.enum(CHANNELS);
export const PrioritySchema = z.enum(PRIORITIES);
export const NotificationStatusSchema = z.enum(NOTIFICATION_STATUSES);
export const DeliveryStatusSchema = z.enum(DELIVERY_STATUSES);
export const CampaignStatusSchema = z.enum(CAMPAIGN_STATUSES);
export const CampaignRecipientStatusSchema = z.enum(CAMPAIGN_RECIPIENT_STATUSES);
export const ErrorClassSchema = z.enum(ERROR_CLASSES);
export const RetryStateSchema = z.enum(RETRY_STATES);
export const ScopeSchema = z.enum(SCOPES);
export const UserKindSchema = z.enum(USER_KINDS);
export const UserStatusSchema = z.enum(USER_STATUSES);
export const DevicePlatformSchema = z.enum(DEVICE_PLATFORMS);
export const ConsentActionSchema = z.enum(CONSENT_ACTIONS);
export const TemplateStatusSchema = z.enum(TEMPLATE_STATUSES);
export const EventTypeStatusSchema = z.enum(EVENT_TYPE_STATUSES);
export const AuditResultSchema = z.enum(AUDIT_RESULTS);
export const OutboxStatusSchema = z.enum(OUTBOX_STATUSES);

export type Source = z.infer<typeof SourceSchema>;
export type Channel = z.infer<typeof ChannelSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type NotificationStatus = z.infer<typeof NotificationStatusSchema>;
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;
export type CampaignRecipientStatus = z.infer<typeof CampaignRecipientStatusSchema>;
export type ErrorClass = z.infer<typeof ErrorClassSchema>;
export type RetryState = z.infer<typeof RetryStateSchema>;
export type Scope = z.infer<typeof ScopeSchema>;
export type UserKind = z.infer<typeof UserKindSchema>;
export type UserStatus = z.infer<typeof UserStatusSchema>;
export type DevicePlatform = z.infer<typeof DevicePlatformSchema>;
export type ConsentAction = z.infer<typeof ConsentActionSchema>;
export type TemplateStatus = z.infer<typeof TemplateStatusSchema>;
export type EventTypeStatus = z.infer<typeof EventTypeStatusSchema>;
export type AuditResult = z.infer<typeof AuditResultSchema>;
export type OutboxStatus = z.infer<typeof OutboxStatusSchema>;
