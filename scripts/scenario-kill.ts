import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface DemoEnv {
  apiUrl: string;
  opsKey: string;
  bookingKey: string;
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

const call = async <T>(
  method: string,
  path: string,
  key: string,
  body?: unknown,
): Promise<{ data: T }> => {
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

  return parsed as { data: T };
};

const waitFor = async <T>(
  label: string,
  action: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 90_000,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let latest: T | undefined;

  while (Date.now() < deadline) {
    latest = await action();

    if (predicate(latest)) {
      return latest;
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for ${label}`);
};

const compose = (args: string[]): void => {
  execFileSync("docker", ["compose", ...args], { cwd: process.cwd(), stdio: "ignore" });
};

const main = async (): Promise<void> => {
  const ready = await fetch(`${env.apiUrl}/health/ready`);

  if (!ready.ok) {
    throw new Error(`API is not ready; run make demo (${ready.status})`);
  }

  compose(["up", "-d", "worker", "worker-delivery"]);
  await sleep(2_000);

  const runId = Date.now();
  const count = 24;
  const events = Array.from({ length: count }, (_value, index) => {
    const externalId = `cust_${String(index + 1).padStart(5, "0")}`;

    return {
      type: "booking.confirmed",
      schema_version: 1,
      recipient: { external_id: externalId },
      idempotency_key: `scenario:kill:${runId}:${index}`,
      data: {
        booking_id: `bkg_kill_${runId}_${index}`,
        service: "plumbing",
        pro_name: "Ravi",
        scheduled_for: "2026-11-02T10:00:00+05:30",
        address_label: "Home",
      },
    };
  });

  const sentAt = Date.now();
  const accepted = await Promise.all(
    events.map((event) =>
      call<{ notification_id: string }>("POST", "/v1/events", env.bookingKey, event),
    ),
  );
  const notificationIds = accepted.map((response) => response.data.notification_id);

  await sleep(250);
  const killAt = Date.now();
  compose(["kill", "--signal", "SIGKILL", "worker", "worker-delivery"]);

  await sleep(1_000);
  const restartAt = Date.now();
  compose(["start", "worker", "worker-delivery"]);

  const traces = await waitFor(
    "all notifications to reach a terminal state",
    async () =>
      Promise.all(
        notificationIds.map((id) =>
          call<{
            notification: { id: string; status: string };
            deliveries: Array<{ id: string; channel: string; status: string }>;
          }>("GET", `/v1/notifications/${id}/trace`, env.opsKey),
        ),
      ),
    (results) =>
      results.every((result) =>
        ["delivered", "failed", "suppressed", "canceled"].includes(
          result.data.notification.status,
        ),
      ),
    120_000,
  );

  const stats = await waitFor(
    "the outbox to drain",
    async () =>
      (
        await call<{ outbox: { pending: number } }>("GET", "/v1/ops/stats", env.opsKey)
      ).data,
    (value) => value.outbox.pending === 0,
    60_000,
  );

  const recoveredAt = Date.now();
  const uniqueNotifications = new Set(traces.map((trace) => trace.data.notification.id));
  const uniqueDeliveries = traces.every((trace) => {
    const channels = trace.data.deliveries.map((delivery) => delivery.channel);
    return new Set(channels).size === channels.length;
  });
  const checks = [
    { name: "all accepts returned a notification", ok: uniqueNotifications.size === count },
    { name: "all notifications terminal", ok: true },
    { name: "one delivery per channel", ok: uniqueDeliveries },
    { name: "outbox drained", ok: stats.outbox.pending === 0 },
    { name: "notification IDs preserved", ok: traces.every((trace, index) => trace.data.notification.id === notificationIds[index]) },
  ];
  const passed = checks.every((check) => check.ok);

  const report = `# Worker kill scenario

Generated by \`pnpm scenario:kill\` on ${new Date().toISOString()}.

| Field | Value |
|---|---|
| Result | ${passed ? "PASS" : "FAIL"} |
| Events accepted | ${count} |
| Unique notifications | ${uniqueNotifications.size} |
| Worker kill signal | SIGKILL |
| Outbox pending after recovery | ${stats.outbox.pending} |

## Timeline

| Step | Offset |
|---|---|
| Events accepted | ${((sentAt - sentAt) / 1000).toFixed(2)}s |
| Worker killed | ${((killAt - sentAt) / 1000).toFixed(2)}s |
| Worker restarted | ${((restartAt - sentAt) / 1000).toFixed(2)}s |
| All notifications terminal | ${((recoveredAt - sentAt) / 1000).toFixed(2)}s |

## Assertions

| Check | Result |
|---|---|
${checks.map((check) => `| ${check.name} | ${check.ok ? "pass" : "FAIL"} |`).join("\n")}

The worker was killed with SIGKILL after accepting the events. The events were already
committed with outbox rows, so the test checks that the restarted worker drains them
without losing a notification or creating a second delivery for the same channel.
`;

  const directory = resolve(process.cwd(), "scenario-results");
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, "worker-kill.md"), report);
  writeFileSync(
    resolve(directory, "worker-kill.json"),
    `${JSON.stringify({ passed, count, sentAt, killAt, restartAt, recoveredAt, stats, checks }, null, 2)}\n`,
  );

  process.stdout.write(`${report}\n`);

  if (!passed) {
    process.exitCode = 1;
  }
};

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      compose(["start", "worker", "worker-delivery"]);
    } catch {
      // The worker is already running or Docker is unavailable.
    }
  });
