-- CreateEnum
CREATE TYPE "source" AS ENUM ('booking', 'payments', 'security', 'growth', 'ops');

-- CreateEnum
CREATE TYPE "channel" AS ENUM ('email', 'in_app', 'push', 'sms');

-- CreateEnum
CREATE TYPE "priority" AS ENUM ('critical', 'high', 'normal', 'low');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('accepted', 'scheduled', 'processing', 'partially_delivered', 'delivered', 'failed', 'canceled', 'suppressed');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('pending', 'sending', 'accepted', 'delivered', 'retry_scheduled', 'unknown', 'failed', 'canceled', 'suppressed');

-- CreateEnum
CREATE TYPE "campaign_status" AS ENUM ('draft', 'scheduled', 'running', 'paused', 'completed', 'canceled', 'failed');

-- CreateEnum
CREATE TYPE "campaign_recipient_status" AS ENUM ('pending', 'queued', 'sent', 'delivered', 'failed', 'suppressed', 'canceled');

-- CreateEnum
CREATE TYPE "error_class" AS ENUM ('permanent', 'transient', 'rate_limit', 'unknown', 'auth', 'invalid_recipient', 'suppressed');

-- CreateEnum
CREATE TYPE "retry_state" AS ENUM ('pending', 'claimed', 'succeeded', 'exhausted', 'canceled');

-- CreateEnum
CREATE TYPE "api_client_kind" AS ENUM ('service', 'operator');

-- CreateEnum
CREATE TYPE "user_kind" AS ENUM ('customer', 'pro', 'ops');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "device_platform" AS ENUM ('ios', 'android', 'web');

-- CreateEnum
CREATE TYPE "device_status" AS ENUM ('active', 'invalidated');

-- CreateEnum
CREATE TYPE "consent_action" AS ENUM ('granted', 'revoked');

-- CreateEnum
CREATE TYPE "template_status" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "event_type_status" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "outbox_status" AS ENUM ('pending', 'published', 'failed');

-- CreateEnum
CREATE TYPE "audit_result" AS ENUM ('success', 'failure');

-- CreateTable
CREATE TABLE "api_clients" (
    "id" TEXT NOT NULL,
    "source" "source" NOT NULL,
    "kind" "api_client_kind" NOT NULL DEFAULT 'service',
    "name" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "rotated_from_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_controls" (
    "source" "source" NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "paused_at" TIMESTAMP(3),
    "paused_by" TEXT,
    "reason" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_controls_pkey" PRIMARY KEY ("source")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "kind" "user_kind" NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "display_name" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "status" "user_status" NOT NULL DEFAULT 'active',
    "city" TEXT,
    "last_booking_at" TIMESTAMP(3),
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" "device_platform" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "device_status" NOT NULL DEFAULT 'active',
    "last_seen_at" TIMESTAMP(3),
    "invalidated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preferences" (
    "user_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "channel" "channel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "source" "source" NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "preferences_pkey" PRIMARY KEY ("user_id","category","channel")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "user_id" TEXT NOT NULL,
    "quiet_start" TEXT,
    "quiet_end" TEXT,
    "marketing_paused" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "consent_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "channel" "channel" NOT NULL,
    "action" "consent_action" NOT NULL,
    "source" "source" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_hash" TEXT,

    CONSTRAINT "consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppression_list" (
    "id" TEXT NOT NULL,
    "channel" "channel" NOT NULL,
    "address_hash" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "provider" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppression_list_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_types" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "schema" JSONB NOT NULL DEFAULT '{}',
    "default_priority" "priority" NOT NULL,
    "policy" JSONB NOT NULL DEFAULT '{}',
    "allowed_channels" "channel"[],
    "allowed_sources" "source"[],
    "dedupe_window_seconds" INTEGER NOT NULL,
    "status" "event_type_status" NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "channel" "channel" NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "template_status" NOT NULL DEFAULT 'draft',
    "current_version_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_versions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "subject" TEXT,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "variables_schema" JSONB NOT NULL DEFAULT '{}',
    "published_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source" "source" NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_version" INTEGER NOT NULL,
    "priority" "priority" NOT NULL,
    "status" "notification_status" NOT NULL DEFAULT 'accepted',
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "policy_snapshot" JSONB,
    "scheduled_for" TIMESTAMP(3),
    "trace_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_events" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fanout_plans" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "policy_hash" TEXT NOT NULL,
    "policy_snapshot" JSONB NOT NULL,
    "channels" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fanout_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "channel" "channel" NOT NULL,
    "priority" "priority" NOT NULL,
    "status" "delivery_status" NOT NULL DEFAULT 'pending',
    "template_version_id" TEXT,
    "provider" TEXT NOT NULL,
    "provider_message_id" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_attempts" (
    "id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "error_class" "error_class",
    "error_code" TEXT,
    "latency_ms" INTEGER NOT NULL,
    "response" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retry_schedules" (
    "id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "channel" "channel" NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "attempt" INTEGER NOT NULL,
    "state" "retry_state" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retry_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "delivery_id" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "source" "source" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "deep_link" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMP(3),
    "sequence" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "inbox_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "shard" INTEGER NOT NULL,
    "topic" TEXT NOT NULL,
    "partition_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "status" "outbox_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "channel" "channel" NOT NULL,
    "audience" JSONB NOT NULL,
    "scheduled_for" TIMESTAMP(3),
    "rate_limit" INTEGER NOT NULL DEFAULT 50,
    "status" "campaign_status" NOT NULL DEFAULT 'draft',
    "created_by" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipients" (
    "campaign_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "shard" INTEGER NOT NULL,
    "status" "campaign_recipient_status" NOT NULL DEFAULT 'pending',
    "notification_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("campaign_id","user_id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "shard" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "error" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actor_key_id" TEXT,
    "actor_label" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "result" "audit_result" NOT NULL,
    "trace_id" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dead_letters" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "partition" INTEGER,
    "offset" BIGINT,
    "delivery_id" TEXT,
    "notification_id" TEXT,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL,
    "error_class" "error_class" NOT NULL,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replayed_at" TIMESTAMP(3),
    "discarded_at" TIMESTAMP(3),
    "discard_reason" TEXT,

    CONSTRAINT "dead_letters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_faults" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "channel" "channel" NOT NULL,
    "outcome" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_faults_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_clients_key_prefix_key" ON "api_clients"("key_prefix");

-- CreateIndex
CREATE INDEX "api_clients_source_idx" ON "api_clients"("source");

-- CreateIndex
CREATE UNIQUE INDEX "users_external_id_key" ON "users"("external_id");

-- CreateIndex
CREATE INDEX "users_city_last_booking_idx" ON "users"("city", "last_booking_at");

-- CreateIndex
CREATE INDEX "users_kind_idx" ON "users"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "devices_token_hash_key" ON "devices"("token_hash");

-- CreateIndex
CREATE INDEX "devices_user_id_status_idx" ON "devices"("user_id", "status");

-- CreateIndex
CREATE INDEX "preferences_category_channel_idx" ON "preferences"("category", "channel");

-- CreateIndex
CREATE INDEX "consent_events_user_id_occurred_at_idx" ON "consent_events"("user_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "suppression_list_channel_address_hash_key" ON "suppression_list"("channel", "address_hash");

-- CreateIndex
CREATE INDEX "event_types_key_status_idx" ON "event_types"("key", "status");

-- CreateIndex
CREATE UNIQUE INDEX "event_types_key_version_key" ON "event_types"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "templates_current_version_id_key" ON "templates"("current_version_id");

-- CreateIndex
CREATE INDEX "templates_key_locale_idx" ON "templates"("key", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "templates_key_channel_locale_key" ON "templates"("key", "channel", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "template_versions_template_id_version_key" ON "template_versions"("template_id", "version");

-- CreateIndex
CREATE INDEX "notifications_user_created_idx" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_scheduler_idx" ON "notifications"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "notifications_trace_id_idx" ON "notifications"("trace_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_idempotency_key" ON "notifications"("user_id", "source", "idempotency_key");

-- CreateIndex
CREATE INDEX "notification_events_notification_id_created_at_idx" ON "notification_events"("notification_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "fanout_plans_notification_id_key" ON "fanout_plans"("notification_id");

-- CreateIndex
CREATE INDEX "deliveries_retry_idx" ON "deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "deliveries_user_id_created_at_idx" ON "deliveries"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_notification_channel" ON "deliveries"("notification_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_attempts_delivery_id_attempt_key" ON "delivery_attempts"("delivery_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "retry_schedules_delivery_id_key" ON "retry_schedules"("delivery_id");

-- CreateIndex
CREATE INDEX "retry_schedules_due_idx" ON "retry_schedules"("state", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "provider_events_provider_event_id_key" ON "provider_events"("provider", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_items_delivery_id_key" ON "inbox_items"("delivery_id");

-- CreateIndex
CREATE INDEX "inbox_items_user_sequence_idx" ON "inbox_items"("user_id", "sequence" DESC);

-- CreateIndex
CREATE INDEX "inbox_items_unread_idx" ON "inbox_items"("user_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_items_user_notification" ON "inbox_items"("user_id", "notification_id");

-- CreateIndex
CREATE INDEX "outbox_claim_idx" ON "outbox"("status", "available_at", "id");

-- CreateIndex
CREATE INDEX "outbox_published_at_idx" ON "outbox"("published_at");

-- CreateIndex
CREATE INDEX "campaigns_scheduler_idx" ON "campaigns"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "campaign_recipients_status_idx" ON "campaign_recipients"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "job_runs_job_shard_started_at_idx" ON "job_runs"("job", "shard", "started_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_actor_key_id_created_at_idx" ON "audit_log"("actor_key_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_resource_type_resource_id_idx" ON "audit_log"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "dead_letters_created_at_idx" ON "dead_letters"("created_at" DESC);

-- CreateIndex
CREATE INDEX "dead_letters_topic_created_at_idx" ON "dead_letters"("topic", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "provider_faults_provider_channel_key" ON "provider_faults"("provider", "channel");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preferences" ADD CONSTRAINT "preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_events" ADD CONSTRAINT "notification_events_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fanout_plans" ADD CONSTRAINT "fanout_plans_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retry_schedules" ADD CONSTRAINT "retry_schedules_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
