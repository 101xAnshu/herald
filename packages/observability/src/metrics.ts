import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from "prom-client";

export const registry = new Registry();

collectDefaultMetrics({ register: registry, prefix: "herald_process_" });

export const httpRequestsTotal = new Counter({
  name: "herald_http_requests_total",
  help: "HTTP requests handled by the API",
  labelNames: ["route", "method", "status", "source"],
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: "herald_http_request_duration_seconds",
  help: "HTTP request duration",
  labelNames: ["route", "method"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

export const eventsAccepted = new Counter({
  name: "herald_events_accepted_total",
  help: "Events accepted by ingest",
  labelNames: ["event_type", "priority", "source"],
  registers: [registry],
});

export const eventsRejected = new Counter({
  name: "herald_events_rejected_total",
  help: "Events rejected by ingest",
  labelNames: ["reason", "source"],
  registers: [registry],
});

export const outboxPending = new Gauge({
  name: "herald_outbox_pending",
  help: "Pending outbox rows",
  labelNames: ["shard"],
  registers: [registry],
});

export const outboxOldestAge = new Gauge({
  name: "herald_outbox_oldest_age_seconds",
  help: "Age of the oldest pending outbox row",
  labelNames: ["shard"],
  registers: [registry],
});

export const consumerLag = new Gauge({
  name: "herald_kafka_consumer_lag",
  help: "Kafka consumer lag",
  labelNames: ["topic", "group", "partition"],
  registers: [registry],
});

export const orchestratorDuration = new Histogram({
  name: "herald_orchestrator_duration_seconds",
  help: "Time spent orchestrating a notification",
  labelNames: ["priority", "outcome"],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

export const fanoutDeliveries = new Counter({
  name: "herald_fanout_deliveries_total",
  help: "Deliveries created by fanout",
  labelNames: ["channel", "priority", "source"],
  registers: [registry],
});

export const deliveriesTotal = new Counter({
  name: "herald_deliveries_total",
  help: "Delivery outcomes",
  labelNames: ["channel", "status", "provider"],
  registers: [registry],
});

export const deliveryAttempts = new Counter({
  name: "herald_delivery_attempts_total",
  help: "Provider attempts",
  labelNames: ["channel", "provider", "result"],
  registers: [registry],
});

export const deliveryLatency = new Histogram({
  name: "herald_delivery_latency_seconds",
  help: "Delivery stage latency",
  labelNames: ["channel", "stage"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

export const retriesScheduled = new Gauge({
  name: "herald_retries_scheduled",
  help: "Retries waiting to run",
  labelNames: ["channel"],
  registers: [registry],
});

export const retryBudgetRatio = new Gauge({
  name: "herald_retry_budget_ratio",
  help: "Retries divided by channel traffic",
  labelNames: ["channel"],
  registers: [registry],
});

export const dlqDepth = new Gauge({
  name: "herald_dlq_depth",
  help: "Dead letters waiting for an operator",
  labelNames: ["stage", "channel"],
  registers: [registry],
});

export const providerCircuitState = new Gauge({
  name: "herald_provider_circuit_state",
  help: "Circuit state: 0 closed, 1 half-open, 2 open",
  labelNames: ["provider"],
  registers: [registry],
});

export const providerRateLimitRemaining = new Gauge({
  name: "herald_provider_rate_limit_remaining",
  help: "Tokens left in a provider bucket",
  labelNames: ["provider"],
  registers: [registry],
});

export const dedupeHits = new Counter({
  name: "herald_dedupe_hits_total",
  help: "Duplicate events suppressed",
  labelNames: ["source"],
  registers: [registry],
});

export const duplicateDeliveries = new Counter({
  name: "herald_duplicate_deliveries_total",
  help: "Duplicate provider deliveries detected",
  labelNames: ["channel"],
  registers: [registry],
});

export const inboxItems = new Counter({
  name: "herald_inbox_items_total",
  help: "Inbox items created",
  labelNames: ["source"],
  registers: [registry],
});

export const campaignRecipients = new Counter({
  name: "herald_campaign_recipients_total",
  help: "Campaign recipient state changes",
  labelNames: ["status", "channel"],
  registers: [registry],
});

export const campaignProgress = new Gauge({
  name: "herald_campaign_progress_ratio",
  help: "Progress of the most recently observed campaign",
  registers: [registry],
});

export const sourcePaused = new Gauge({
  name: "herald_source_paused",
  help: "Source pause state: 0 active, 1 paused",
  labelNames: ["source"],
  registers: [registry],
});

export const shardUp = new Gauge({
  name: "herald_shard_up",
  help: "Shard reachability",
  labelNames: ["shard"],
  registers: [registry],
});

export const shardWriteLatency = new Histogram({
  name: "herald_shard_write_latency_seconds",
  help: "Shard write latency",
  labelNames: ["shard", "operation"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registry],
});

export const jobLastSuccess = new Gauge({
  name: "herald_job_last_success_timestamp",
  help: "Unix timestamp of the last successful job run",
  labelNames: ["job", "shard"],
  registers: [registry],
});

export const jobDuration = new Histogram({
  name: "herald_job_duration_seconds",
  help: "Background job duration",
  labelNames: ["job"],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 30],
  registers: [registry],
});

export const failoverDuration = new Gauge({
  name: "herald_failover_duration_seconds",
  help: "Measured database failover duration",
  registers: [registry],
});

export const failoverReplicationLag = new Gauge({
  name: "herald_failover_replication_lag_seconds",
  help: "Replication lag observed during a failover check",
  registers: [registry],
});

export const buildInfo = new Gauge({
  name: "herald_build_info",
  help: "Build identity",
  labelNames: ["version", "commit"],
  registers: [registry],
});

export const setBuildInfo = (version: string, commit: string): void => {
  buildInfo.labels(version, commit).set(1);
};

export const metricsText = async (): Promise<string> => registry.metrics();

export const metricsContentType = (): string => registry.contentType;

export const resetMetrics = (): void => {
  registry.resetMetrics();
};
