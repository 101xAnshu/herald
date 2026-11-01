import { readFileSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { resolve } from "node:path";

import autocannon from "autocannon";

type AutocannonResult = Awaited<ReturnType<typeof autocannon>>;

interface Options {
  url: string;
  key: string;
  rate: number;
  connections: number;
  duration: number;
  warmup: number;
  users: number;
  opsKey: string;
  json: boolean;
}

const args = process.argv.slice(2);

const option = (name: string, fallback: string): string => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
};

const flag = (name: string): boolean => args.includes(`--${name}`);

const readDemoEnv = (): Record<string, string> => {
  try {
    const text = readFileSync(resolve(process.cwd(), ".herald/demo.env"), "utf8");
    const values: Record<string, string> = {};

    for (const line of text.split("\n")) {
      const separator = line.indexOf("=");

      if (separator > 0) {
        values[line.slice(0, separator)] = line.slice(separator + 1).trim();
      }
    }

    return values;
  } catch {
    return {};
  }
};

const readDotEnv = (): Record<string, string> => {
  try {
    const text = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    const values: Record<string, string> = {};

    for (const line of text.split("\n")) {
      const separator = line.indexOf("=");

      if (separator > 0) {
        values[line.slice(0, separator)] = line.slice(separator + 1).trim();
      }
    }

    return values;
  } catch {
    return {};
  }
};

const demo = readDemoEnv();
const dotenv = readDotEnv();
const options: Options = {
  url: option("url", process.env["HERALD_API_URL"] ?? demo["HERALD_API_URL"] ?? "http://localhost:3000"),
  key: option("key", process.env["HERALD_BOOKING_API_KEY"] ?? demo["HERALD_BOOKING_API_KEY"] ?? ""),
  opsKey: process.env["HERALD_OPS_API_KEY"] ?? demo["HERALD_OPS_API_KEY"] ?? "",
  rate: Number(option("rate", "900")),
  connections: Number(option("connections", "20")),
  duration: Number(option("duration", "15")),
  warmup: Number(option("warmup", "3")),
  users: Math.max(1, Math.min(1_000, Number(option("users", "500")))),
  json: flag("json"),
};

if (!options.key) {
  process.stderr.write("missing booking API key; run make demo or herald init --demo\n");
  process.exit(1);
}

interface OpsSummary {
  notifications: Record<string, number>;
  outbox: { pending: number; oldest_age_seconds: number };
  dlq: { depth: number };
  retries: { due: number };
}

const readOps = async (): Promise<OpsSummary | null> => {
  if (!options.opsKey) {
    return null;
  }

  try {
    const response = await fetch(`${options.url}/v1/ops/stats`, {
      headers: { authorization: `Bearer ${options.opsKey}` },
    });

    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as { data: OpsSummary };
    return body.data;
  } catch {
    return null;
  }
};

const runId = Date.now().toString(36);
let requestIndex = 0;

const setupRequest = (request: Record<string, unknown>) => {
  requestIndex += 1;
  const index = requestIndex;
  const externalId = `cust_${String((index % options.users) + 1).padStart(5, "0")}`;
  const payload = JSON.stringify({
    type: "booking.confirmed",
    schema_version: 1,
    recipient: { external_id: externalId },
    idempotency_key: `bench-http:${runId}:${index}`,
    data: {
      booking_id: `bkg_http_${index}`,
      service: "plumbing",
      pro_name: "Ravi",
      scheduled_for: "2026-11-02T10:00:00+05:30",
      address_label: "Home",
    },
  });

  request.body = payload;
  request.headers = {
    ...(request.headers as Record<string, string>),
    "Content-Type": "application/json",
  };

  return request;
};

interface RunOutput {
  result: AutocannonResult;
  samples: number[];
}

const run = (duration: number, rate: number, connections: number): Promise<RunOutput> =>
  new Promise<RunOutput>((resolve, reject) => {
    const samples: number[] = [];
    const instance = autocannon(
      {
        url: `${options.url.replace(/\/$/, "")}/v1/events`,
        method: "POST",
        headers: { authorization: `Bearer ${options.key}` },
        connections,
        duration,
        overallRate: rate,
        pipelining: 1,
        timeout: 15,
        requests: [{ setupRequest }],
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve({ result, samples });
      },
    );

    instance.on("response", (...args: unknown[]) => {
      const responseTime = args[3];

      if (typeof responseTime === "number") {
        samples.push(responseTime);
      }
    });
  });

const percentile = (samples: number[], p: number): number => {
  if (samples.length === 0) {
    return 0;
  }

  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? 0;
};

const mean = (samples: number[]): number =>
  samples.length === 0 ? 0 : samples.reduce((sum, value) => sum + value, 0) / samples.length;

const reachedTarget = (achieved: number, target: number): boolean => achieved >= target * 0.9;

const main = async (): Promise<void> => {
  if (options.warmup > 0) {
    process.stdout.write(`warming up for ${options.warmup}s\n`);
    await run(options.warmup, Math.min(100, options.rate), Math.min(5, options.connections));
  }

  const before = await readOps();
  const cpuBefore = process.cpuUsage();
  const started = Date.now();

  const { result, samples } = await run(options.duration, options.rate, options.connections);

  const elapsedSeconds = (Date.now() - started) / 1000;
  const cpuAfter = process.cpuUsage(cpuBefore);
  const cpuSeconds = (cpuAfter.user + cpuAfter.system) / 1_000_000;
  const clientCpuPercent = (cpuSeconds / elapsedSeconds) * 100;
  const after = await readOps();

  const requestsSent = result["2xx"] + result["4xx"] + result["5xx"];
  const accepted = result["2xx"];
  const failed = result["4xx"] + result["5xx"] + result.errors;
  const passed = failed === 0 && result.errors === 0;

  const report = `# HTTP ingest benchmark

Generated by \`pnpm bench:http\` on ${new Date().toISOString()}.

Autocannon drives \`POST /v1/events\` directly. Each request uses a unique
idempotency key and cycles through ${options.users} seeded recipients, so the run
measures the insert path rather than the duplicate fast path.

## Load

| Field | Value |
|---|---|
| Host | ${cpus()[0]?.model ?? "unknown"}, ${cpus().length} vCPU |
| Memory | ${(totalmem() / 1024 ** 3).toFixed(1)} GiB |
| API | ${options.url} |
| Connections | ${options.connections} |
| Pipelining | 1 |
| Target rate | ${options.rate} requests/s |
| Duration | ${options.duration}s |
| Warmup | ${options.warmup}s |
| API workers | ${process.env["API_WORKERS"] ?? dotenv["API_WORKERS"] ?? "unknown"} |
| DB pool max | ${process.env["DB_POOL_MAX"] ?? dotenv["DB_POOL_MAX"] ?? "unknown"} |
| Worker state | ${option("worker", "unknown")} |
| Client | in-process autocannon |

## Result

| Field | Value |
|---|---|
| Requests sent | ${requestsSent} |
| Latency samples | ${samples.length} |
| Accepted (2xx) | ${accepted} |
| Rejected (4xx) | ${result["4xx"]} |
| Server errors (5xx) | ${result["5xx"]} |
| Connection errors | ${result.errors} |
| Timeouts | ${result.timeouts} |
| Throughput | ${result.requests.average.toFixed(1)} requests/s |
| Mean latency | ${mean(samples).toFixed(1)} ms |
| p50 latency | ${percentile(samples, 50).toFixed(1)} ms |
| p90 latency | ${percentile(samples, 90).toFixed(1)} ms |
| p95 latency | ${percentile(samples, 95).toFixed(1)} ms |
| p99 latency | ${percentile(samples, 99).toFixed(1)} ms |
| Max latency | ${(samples.length > 0 ? Math.max(...samples) : 0).toFixed(1)} ms |
| Client CPU | ${clientCpuPercent.toFixed(1)}% of one core |

## Pipeline state

| Metric | Before | After |
|---|---|---|
| Outbox pending | ${before?.outbox.pending ?? "n/a"} | ${after?.outbox.pending ?? "n/a"} |
| Outbox oldest (s) | ${before?.outbox.oldest_age_seconds ?? "n/a"} | ${after?.outbox.oldest_age_seconds ?? "n/a"} |
| DLQ depth | ${before?.dlq.depth ?? "n/a"} | ${after?.dlq.depth ?? "n/a"} |
| Due retries | ${before?.retries.due ?? "n/a"} | ${after?.retries.due ?? "n/a"} |
| Notifications | ${before ? JSON.stringify(before.notifications) : "n/a"} | ${after ? JSON.stringify(after.notifications) : "n/a"} |

## Reading

This is an HTTP-level benchmark. It does not wait for fanout or delivery, and it
does not prove that the async pipeline kept up. Run it with the worker stopped to
isolate ingest, or leave the worker running to measure the full pipeline's effect
on ingest latency.

The default local rate limiter allows 1,000 ingest requests per second per key and
per IP. A run above that rate will show 4xx responses from the limiter rather than
an API ceiling. The default target stays below it on purpose.

The result is ${passed ? "clean: every request received a 2xx response" : "not clean: inspect 4xx, 5xx, or connection errors before quoting these numbers"}.
${reachedTarget(result.requests.average, options.rate) ? "" : "The API did not reach the target rate. The throughput figures are the observed ceiling for this host, connection count, and database latency, not the requested rate."}
`;

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          target_rate: options.rate,
          connections: options.connections,
          duration: options.duration,
          requests: requestsSent,
          accepted,
          rejected: result["4xx"],
          server_errors: result["5xx"],
          errors: result.errors,
          p50_ms: percentile(samples, 50),
          p90_ms: percentile(samples, 90),
          p95_ms: percentile(samples, 95),
          p99_ms: percentile(samples, 99),
          throughput: result.requests.average,
          client_cpu_percent: clientCpuPercent,
          passed,
        },
        null,
        2,
      )}\n`,
    );
  }

  const path = resolve(process.cwd(), option("output", "docs/BENCH-HTTP.md"));
  writeFileSync(path, report);
  process.stdout.write(report);
  process.stdout.write(`\nwrote ${path}\n`);

  if (!passed) {
    process.exitCode = 1;
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
