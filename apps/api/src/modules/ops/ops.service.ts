import type { FaultInjection, Source } from "@herald/contracts";
import { prisma } from "@herald/db";
import {
  discardDlq,
  getDlq,
  getOpsStats,
  listAudit,
  listDlq,
  listOutbox,
  listProviderFaults,
  listRetries,
  listSources,
  promoteSingleRetry,
  replayDlq,
  replicationStatus,
  setProviderFault,
  setSourcePaused,
} from "@herald/db";

const dlqView = (row: {
  id: string;
  topic: string;
  partition: number | null;
  offset: bigint | null;
  deliveryId: string | null;
  notificationId: string | null;
  payload: unknown;
  headers: unknown;
  attempts: number;
  errorClass: string;
  errorCode: string | null;
  createdAt: Date;
  replayedAt: Date | null;
  discardedAt: Date | null;
}) => ({
  id: row.id,
  topic: row.topic,
  partition: row.partition,
  offset: row.offset === null ? null : row.offset.toString(),
  delivery_id: row.deliveryId,
  notification_id: row.notificationId,
  payload: row.payload,
  headers: row.headers,
  attempts: row.attempts,
  error_class: row.errorClass.toLowerCase(),
  error_code: row.errorCode,
  created_at: row.createdAt.toISOString(),
  replayed_at: row.replayedAt?.toISOString() ?? null,
  discarded_at: row.discardedAt?.toISOString() ?? null,
});

export const stats = () => getOpsStats();

export const outbox = async (query: { limit: number; status?: string }) => {
  const rows = await listOutbox(query);
  return rows.map((row) => ({
    id: row.id,
    topic: row.topic,
    shard: row.shard,
    status: row.status.toLowerCase(),
    attempts: row.attempts,
    available_at: row.availableAt.toISOString(),
    published_at: row.publishedAt?.toISOString() ?? null,
    last_error: row.lastError,
    created_at: row.createdAt.toISOString(),
  }));
};

export const retries = async (query: { limit: number; dueOnly?: boolean }) => {
  const rows = await listRetries(query);
  return rows.map((row) => ({
    delivery_id: row.deliveryId,
    channel: row.channel.toLowerCase(),
    due_at: row.dueAt.toISOString(),
    attempt: row.attempt,
    state: row.state.toLowerCase(),
    notification_id: row.delivery.notificationId,
  }));
};

export const promoteRetry = async (deliveryId: string) => ({
  delivery_id: deliveryId,
  promoted: await promoteSingleRetry(deliveryId),
});

export const dlq = async (query: { limit: number; includeDiscarded?: boolean }) =>
  (await listDlq(query)).map(dlqView);

export const dlqDetail = async (id: string) => {
  const found = await getDlq(id);
  return dlqView(found.record);
};

export const replay = (id: string, dryRun: boolean, actor: string) =>
  replayDlq(id, { dryRun, actor });

export const discard = (id: string, reason: string, actor: string) =>
  discardDlq(id, reason, actor);

export const pauseSource = (source: Source, reason: string, actor: string) =>
  setSourcePaused(source, true, reason, actor);

export const resumeSource = (source: Source, reason: string, actor: string) =>
  setSourcePaused(source, false, reason, actor);

export const sources = () => listSources();

export const providers = async () => ({
  faults: (await listProviderFaults()).map((fault) => ({
    provider: fault.provider,
    channel: fault.channel.toLowerCase(),
    outcome: fault.outcome,
    expires_at: fault.expiresAt.toISOString(),
  })),
  adapters: [
    { name: "smtp", channel: "email", kind: "smtp" },
    { name: "in_app", channel: "in_app", kind: "durable" },
    { name: "mock_push", channel: "push", kind: "mock" },
    { name: "mock_sms", channel: "sms", kind: "mock" },
  ],
});

export const injectFault = (input: FaultInjection, actor: string) => setProviderFault(input, actor);

export const audit = (limit: number) =>
  listAudit({ limit }).then((rows) =>
    rows.map((row) => ({
      id: row.id,
      actor: row.actorLabel,
      action: row.action,
      resource_type: row.resourceType,
      resource_id: row.resourceId,
      result: row.result.toLowerCase(),
      trace_id: row.traceId,
      metadata: row.metadata,
      created_at: row.createdAt.toISOString(),
    })),
  );

export const failoverState = async () => {
  const replication = await replicationStatus().catch(() => []);
  const settings = await prisma.$queryRaw<Array<{ wal_level: string; max_wal_senders: string }>>`
    SELECT current_setting('wal_level') AS wal_level,
           current_setting('max_wal_senders') AS max_wal_senders
  `;

  return {
    wal_level: settings[0]?.wal_level ?? "unknown",
    max_wal_senders: settings[0]?.max_wal_senders ?? "unknown",
    replicas: replication.map((replica) => ({
      client_addr: replica.client_addr,
      state: replica.state,
      lag_seconds: replica.lag_seconds,
    })),
    dry_run_only: true,
  };
};

export const failoverDryRun = async () => {
  const state = await failoverState();
  return {
    ...state,
    checks: [
      { name: "wal_level", ok: state.wal_level === "replica" || state.wal_level === "logical" },
      { name: "max_wal_senders", ok: Number(state.max_wal_senders) > 0 },
      { name: "standby_connected", ok: state.replicas.some((replica) => replica.state === "streaming") },
      {
        name: "lag_within_budget",
        ok: state.replicas.every((replica) => (replica.lag_seconds ?? 0) < 10),
      },
    ],
    steps: [
      "Pause producer traffic and wait for the standby to catch up.",
      "Promote the standby with pg_promote().",
      "Point DATABASE_URL at the promoted node.",
      "Restart the API and worker.",
      "Let the outbox relay publish unpublished rows.",
      "Send one event and confirm it reaches a terminal state.",
    ],
  };
};
