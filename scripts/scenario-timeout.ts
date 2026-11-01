import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface DemoEnv {
  apiUrl: string;
  opsKey: string;
  bookingKey: string;
}

interface TraceEntry {
  at: string;
  kind: string;
  channel: string | null;
  status: string | null;
  attempt: number | null;
  detail: Record<string, unknown>;
}

interface Trace {
  notification: {
    id: string;
    status: string;
    idempotency_key: string;
  };
  deliveries: Array<{
    id: string;
    channel: string;
    status: string;
    attempt_count: number;
  }>;
  timeline: TraceEntry[];
}

const sleep = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const readDemo = (): DemoEnv => {
  const text = readFileSync(resolve(process.cwd(), ".herald/demo.env"), "utf8");
  const values = Object.fromEntries(
    text
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );

  if (!values["HERALD_OPS_API_KEY"] || !values["HERALD_BOOKING_API_KEY"]) {
    throw new Error("demo credentials are missing; run make demo");
  }

  return {
    apiUrl: values["HERALD_API_URL"] ?? "http://localhost:3000",
    opsKey: values["HERALD_OPS_API_KEY"],
    bookingKey: values["HERALD_BOOKING_API_KEY"],
  };
};

const env = readDemo();

interface Envelope<T> {
  data: T;
}

const call = async <T>(
  method: string,
  path: string,
  key: string,
  body?: unknown,
): Promise<Envelope<T>> => {
  const response = await fetch(`${env.apiUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    throw new Error(`${method} ${path} failed with ${response.status}: ${text.slice(0, 300)}`);
  }

  return parsed as Envelope<T>;
};

const traceOf = async (id: string): Promise<Trace> =>
  (await call<Trace>("GET", `/v1/notifications/${id}/trace`, env.opsKey)).data;

const waitFor = async <T>(
  label: string,
  action: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 45_000,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let latest: T | undefined;

  while (Date.now() < deadline) {
    latest = await action();

    if (predicate(latest)) {
      return latest;
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for ${label}`);
};

const offset = (start: number, at: number): string => `${((at - start) / 1000).toFixed(2)}s`;

const main = async (): Promise<void> => {
  const ready = await fetch(`${env.apiUrl}/health/ready`);

  if (!ready.ok) {
    throw new Error(`API is not ready; run make demo (${ready.status})`);
  }

  const runId = Date.now();
  const externalId = "cust_00010";
  const idempotencyKey = `scenario:timeout:${runId}`;
  let faultInjected = false;

  try {
    await call("POST", "/v1/ops/providers/mock/fault", env.opsKey, {
      channel: "push",
      outcome: "accept",
      ttl_seconds: 1,
    });
    await sleep(1_200);
    await call("POST", "/v1/ops/providers/mock/fault", env.opsKey, {
      channel: "push",
      outcome: "timeout",
      ttl_seconds: 120,
    });
    faultInjected = true;

    const acceptedAt = Date.now();
    const accepted = await call<{ notification_id: string; trace_id: string }>(
      "POST",
      "/v1/events",
      env.bookingKey,
      {
        type: "booking.confirmed",
        schema_version: 1,
        recipient: { external_id: externalId },
        idempotency_key: idempotencyKey,
        data: {
          booking_id: `bkg_scenario_${runId}`,
          service: "plumbing",
          pro_name: "Ravi",
          scheduled_for: "2026-11-02T10:00:00+05:30",
          address_label: "Home",
        },
      },
    );
    const notificationId = accepted.data.notification_id;

    const unknownTrace = await waitFor(
      "the push delivery to become unknown",
      () => traceOf(notificationId),
      (trace) =>
        trace.deliveries.some(
          (delivery) => delivery.channel === "push" && ["unknown", "failed"].includes(delivery.status),
        ),
      45_000,
    );
    const unknownAt = Date.now();
    const pushDelivery = unknownTrace.deliveries.find((delivery) => delivery.channel === "push");

    if (!pushDelivery) {
      throw new Error("push delivery was not created; the recipient needs an active device");
    }

    const dlq = await waitFor(
      "the dead letter record",
      async () =>
        (
          await call<Array<{ id: string; delivery_id: string | null; error_code: string | null }>>(
            "GET",
            "/v1/ops/dlq?limit=50",
            env.opsKey,
          )
        ).data.find((record) => record.delivery_id === pushDelivery.id),
      (record) => Boolean(record),
      45_000,
    );
    const dlqAt = Date.now();

    await call("POST", "/v1/ops/providers/mock/fault", env.opsKey, {
      channel: "push",
      outcome: "accept",
      ttl_seconds: 1,
    });
    faultInjected = false;
    await sleep(1_200);

    const dryRun = await call<{ dry_run: boolean }>(
      "POST",
      `/v1/ops/dlq/${dlq.id}/replay`,
      env.opsKey,
      { dry_run: true },
    );

    if (dryRun.data.dry_run !== true) {
      throw new Error("DLQ dry run did not report a dry run");
    }

    const replayAt = Date.now();
    await call("POST", `/v1/ops/dlq/${dlq.id}/replay`, env.opsKey, { dry_run: false });

    const recoveredTrace = await waitFor(
      "the replayed push delivery to recover",
      () => traceOf(notificationId),
      (trace) =>
        trace.deliveries.some(
          (delivery) =>
            delivery.channel === "push" && ["accepted", "delivered"].includes(delivery.status),
        ) &&
        ["delivered", "partially_delivered", "failed"].includes(trace.notification.status),
      45_000,
    );
    const recoveredAt = Date.now();

    const token = await call<{ access_token: string; user_id: string }>(
      "POST",
      "/v1/demo/token",
      env.opsKey,
      { external_id: externalId },
    );
    const inbox = await call<Array<{ notification_id: string }>>(
      "GET",
      "/v1/me/inbox?limit=100",
      token.data.access_token,
    );
    const inboxCount = inbox.data.filter((item) => item.notification_id === notificationId).length;

    const notifications = await call<Array<{ id: string; idempotency_key: string }>>(
      "GET",
      `/v1/notifications?user_id=${token.data.user_id}&limit=100`,
      env.opsKey,
    );
    const matchingNotifications = notifications.data.filter(
      (item) => item.idempotency_key === idempotencyKey,
    ).length;

    const stats = await waitFor(
      "the outbox to drain",
      async () =>
        (
          await call<{ outbox: { pending: number }; dlq: { depth: number } }>(
            "GET",
            "/v1/ops/stats",
            env.opsKey,
          )
        ).data,
      (value) => value.outbox.pending === 0,
      45_000,
    );
    const drainedAt = Date.now();

    const checks = [
      { name: "accepted event exists", ok: matchingNotifications === 1 },
      { name: "timeout observed", ok: ["unknown", "failed"].includes(pushDelivery.status) },
      { name: "DLQ linked to delivery", ok: dlq.delivery_id === pushDelivery.id },
      { name: "dry run returned before apply", ok: dryRun.data.dry_run === true },
      {
        name: "push delivery recovered",
        ok: recoveredTrace.deliveries.some(
          (delivery) =>
            delivery.id === pushDelivery.id && ["accepted", "delivered"].includes(delivery.status),
        ),
      },
      {
        name: "notification ID unchanged",
        ok: recoveredTrace.notification.id === notificationId,
      },
      { name: "one notification per idempotency key", ok: matchingNotifications === 1 },
      { name: "one inbox item", ok: inboxCount === 1 },
      { name: "outbox drained", ok: stats.outbox.pending === 0 },
    ];

    const passed = checks.every((check) => check.ok);
    const timeline = [
      { step: "accepted", offset: offset(acceptedAt, acceptedAt) },
      { step: "push delivery unknown", offset: offset(acceptedAt, unknownAt) },
      { step: "DLQ visible", offset: offset(acceptedAt, dlqAt) },
      { step: "replay applied", offset: offset(acceptedAt, replayAt) },
      { step: "delivery recovered", offset: offset(acceptedAt, recoveredAt) },
      { step: "outbox drained", offset: offset(acceptedAt, drainedAt) },
    ];

    const report = `# Failure recovery scenario

Generated by \`pnpm scenario:timeout\` on ${new Date().toISOString()}.

| Field | Value |
|---|---|
| Result | ${passed ? "PASS" : "FAIL"} |
| User | ${externalId} |
| Notification | ${notificationId} |
| Idempotency key | ${idempotencyKey} |
| Delivery | ${pushDelivery.id} |
| DLQ | ${dlq.id} |
| DLQ error | ${dlq.error_code ?? "unknown"} |
| Timeout observed | ${unknownTrace.deliveries.find((delivery) => delivery.id === pushDelivery.id)?.status ?? "unknown"} |
| Recovered status | ${recoveredTrace.deliveries.find((delivery) => delivery.id === pushDelivery.id)?.status ?? "unknown"} |
| Inbox items for notification | ${inboxCount} |
| Outbox pending after replay | ${stats.outbox.pending} |

## Timeline

| Step | Offset from accept |
|---|---|
${timeline.map((entry) => `| ${entry.step} | ${entry.offset} |`).join("\n")}

## Measurements

| Measurement | Value |
|---|---|
| Accept to timeout/unknown | ${offset(acceptedAt, unknownAt)} |
| Unknown to DLQ | ${offset(unknownAt, dlqAt)} |
| DLQ to replay | ${offset(dlqAt, replayAt)} |
| Replay to recovered | ${offset(replayAt, recoveredAt)} |
| Total accept to recovered | ${offset(acceptedAt, recoveredAt)} |
| Total accept to outbox drained | ${offset(acceptedAt, drainedAt)} |

## Assertions

| Check | Result |
|---|---|
${checks.map((check) => `| ${check.name} | ${check.ok ? "pass" : "FAIL"} |`).join("\n")}

The recovery used the same notification ID. The failed push delivery was replayed from
the DLQ, and the in-app inbox still has one item for the notification.
`;

    const directory = resolve(process.cwd(), "scenario-results");
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, "timeout.md"), report);
    writeFileSync(
      resolve(directory, "timeout.json"),
      `${JSON.stringify({ passed, notificationId, idempotencyKey, timeline, checks, stats }, null, 2)}\n`,
    );

    process.stdout.write(`${report}\n`);

    if (!passed) {
      process.exitCode = 1;
    }
  } finally {
    if (faultInjected) {
      await call("POST", "/v1/ops/providers/mock/fault", env.opsKey, {
        channel: "push",
        outcome: "accept",
        ttl_seconds: 1,
      }).catch(() => undefined);
    }
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
