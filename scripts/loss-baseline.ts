import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadConfig } from "@herald/config";
import { newId } from "@herald/core";
import { getPrisma, relayOutbox } from "@herald/db";
import { createPublisher } from "@herald/queue";
import { Kafka, logLevel } from "kafkajs";

const TOPIC = "herald.loss-baseline.v1";
const ARGS = process.argv.slice(2);

const arg = (name: string, fallback: string): string => {
  const index = ARGS.indexOf(`--${name}`);
  return index === -1 ? fallback : (ARGS[index + 1] ?? fallback);
};

const has = (name: string): boolean => ARGS.includes(`--${name}`);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const kafka = (): Kafka => {
  const config = loadConfig();
  return new Kafka({ clientId: "herald-loss-baseline", brokers: [...config.kafkaBrokers], logLevel: logLevel.ERROR });
};

const ensureTopic = async (): Promise<void> => {
  const admin = kafka().admin();
  await admin.connect();

  try {
    await admin.createTopics({
      waitForLeaders: true,
      topics: [{ topic: TOPIC, numPartitions: 1, replicationFactor: 1 }],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const exists =
      message.includes("already exists") ||
      ("type" in Object(error) && (error as { type?: string }).type === "TOPIC_ALREADY_EXISTS");

    if (!exists) {
      throw error;
    }
  } finally {
    await admin.disconnect();
  }
};

const deleteTopic = async (): Promise<void> => {
  const admin = kafka().admin();
  await admin.connect();
  await admin.deleteTopics({ topics: [TOPIC] }).catch(() => undefined);
  await admin.disconnect();
};

const child = async (): Promise<void> => {
  const mode = arg("mode", "naive");
  const runId = arg("run", "missing");
  const db = getPrisma(0);
  const user = await db.user.findFirst({
    where: { externalId: { startsWith: "cust_" } },
    select: { id: true },
    orderBy: { externalId: "asc" },
  });

  if (!user) {
    throw new Error("no seeded customer found; run make demo first");
  }

  const publisher = createPublisher();

  process.stdout.write(`ready\n`);
  let sequence = 0;

  for (;;) {
    sequence += 1;
    const notificationId = newId();
    const idempotencyKey = `loss:${runId}:${process.pid}:${sequence}`;
    const payload = { run: runId, sequence };

    if (mode === "naive") {
      await db.notification.create({
        data: {
          id: notificationId,
          userId: user.id,
          source: "BOOKING",
          eventType: "loss.baseline",
          eventVersion: 1,
          priority: "NORMAL",
          status: "ACCEPTED",
          idempotencyKey,
          requestHash: notificationId.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
          payload,
          traceId: newId(),
        },
      });

      await publisher.publish(TOPIC, user.id, {
        run: runId,
        notification_id: notificationId,
      });
    } else {
      await db.$transaction(async (tx) => {
        await tx.notification.create({
          data: {
            id: notificationId,
            userId: user.id,
            source: "BOOKING",
            eventType: "loss.baseline",
            eventVersion: 1,
            priority: "NORMAL",
            status: "ACCEPTED",
            idempotencyKey,
            requestHash: notificationId.replaceAll("-", "").padEnd(64, "0").slice(0, 64),
            payload,
            traceId: newId(),
          },
        });

        await tx.outbox.create({
          data: {
            id: newId(),
            aggregateType: "loss",
            aggregateId: notificationId,
            shard: 0,
            topic: TOPIC,
            partitionKey: user.id,
            payload: { run: runId, notification_id: notificationId },
            headers: { run: runId },
          },
        });
      });
    }
  }
};

const spawnChild = (mode: string, runId: string): Promise<void> =>
  new Promise((resolvePromise, reject) => {
    const script = resolve(process.cwd(), "scripts/loss-baseline.ts");
    const proc = spawn(process.execPath, ["--import", "tsx", script, "--child", "--mode", mode, "--run", runId], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let ready = false;

    proc.stdout.on("data", (chunk: Buffer) => {
      if (!ready && chunk.toString().includes("ready")) {
        ready = true;

        const delay = 100 + Math.floor(Math.random() * 300);
        setTimeout(() => {
          proc.kill("SIGKILL");
        }, delay);
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(`[${mode}] ${chunk.toString()}`);
    });

    proc.on("error", reject);
    proc.on("exit", () => resolvePromise());
  });

const collectPublished = async (runId: string): Promise<Set<string>> => {
  const published = new Set<string>();
  const consumer = kafka().consumer({ groupId: `loss-${runId}` });

  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: true });

  let timer: NodeJS.Timeout | undefined;
  const idle = new Promise<void>((resolvePromise) => {
    timer = setTimeout(resolvePromise, 2_500);
  });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) {
        return;
      }

      try {
        const parsed = JSON.parse(message.value.toString()) as { run?: string; notification_id?: string };

        if (parsed.run === runId && parsed.notification_id) {
          published.add(parsed.notification_id);
        }
      } catch {
        // Ignore messages that are not part of this experiment.
      }
    },
  });

  await idle;
  if (timer) {
    clearTimeout(timer);
  }
  await consumer.disconnect();

  return published;
};

const drainOutbox = async (): Promise<number> => {
  const publisher = createPublisher();
  let published = 0;

  for (;;) {
    const result = await relayOutbox(publisher, 500);
    published += result.published;

    if (result.published === 0) {
      break;
    }
  }

  await publisher.disconnect();
  return published;
};

const main = async (): Promise<void> => {
  const iterations = Number(arg("iterations", "20"));
  const modes = has("naive") || has("outbox") ? [has("naive") ? "naive" : "", has("outbox") ? "outbox" : ""].filter(Boolean) : ["naive", "outbox"];
  const db = getPrisma(0);
  const results: Array<{ mode: string; committed: number; published: number; lost: number }> = [];

  await ensureTopic();

  for (const mode of modes) {
    const runId = `${mode}-${Date.now()}`;

    for (let index = 0; index < iterations; index += 1) {
      await spawnChild(mode, runId);
    }

    if (mode === "outbox") {
      await drainOutbox();
    }

    const published = await collectPublished(runId);
    const committed = await db.notification.count({
      where: { idempotencyKey: { startsWith: `loss:${runId}:` } },
    });
    const notifications = await db.notification.findMany({
      where: { idempotencyKey: { startsWith: `loss:${runId}:` } },
      select: { id: true },
    });
    const lost = notifications.filter((row) => !published.has(row.id)).length;

    results.push({ mode, committed, published: published.size, lost });

    await db.notification.deleteMany({ where: { idempotencyKey: { startsWith: `loss:${runId}:` } } });
    await db.outbox.deleteMany({ where: { aggregateType: "loss", aggregateId: { in: notifications.map((row) => row.id) } } });
  }

  await deleteTopic();

  const report = `# Event loss under crash

Generated by \`pnpm loss:baseline\` on ${new Date().toISOString()}.

Each iteration starts a process, lets it commit accepted events, kills it with SIGKILL at a random point after it reports ready, and counts committed notifications that never reached the topic.

| Mode | Committed | Published | Lost | Loss |
|---|---|---|---|---|
${results.map((row) => `| ${row.mode} | ${row.committed} | ${row.published} | ${row.lost} | ${row.committed === 0 ? "n/a" : `${((row.lost / row.committed) * 100).toFixed(2)}%`} |`).join("\n")}

- \`naive\`: writes the notification, then publishes. A kill between the commit and the publish loses the event.
- \`outbox\`: writes the notification and the outbox row in one transaction. A kill before the publish leaves the outbox row, and the relay publishes it after restart.

Both modes use the same topic, the same database, and the same Kafka publisher. The only difference is whether the intent to publish is committed with the event.
`;

  const directory = resolve(process.cwd(), "loss-results");
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, "latest.md"), report);
  writeFileSync(resolve(directory, "latest.json"), `${JSON.stringify({ iterations, results }, null, 2)}\n`);
  process.stdout.write(`${report}\n`);
};

if (has("child")) {
  child().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
} else {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
