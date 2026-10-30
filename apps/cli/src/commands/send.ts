import { readFileSync } from "node:fs";

import { IngestEventSchema, type IngestEvent } from "@herald/contracts";
import { newId } from "@herald/core";
import type { Command } from "commander";

import { clientFor, sourceForEventType } from "../client";
import { resolveProfile } from "../config";
import { fail, info, ok, printJson, printTable } from "../output";

const parseData = (value: string | undefined): Record<string, unknown> => {
  if (!value) {
    return {};
  }

  const parsed: unknown = JSON.parse(value);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("--data must be a JSON object");
  }

  return parsed as Record<string, unknown>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const registerSendCommands = (program: Command): void => {
  program
    .command("send <event-type>")
    .description("send one event")
    .requiredOption("--user <external-id>", "recipient external ID")
    .option("--data <json>", "event data as JSON", "{}")
    .option("--idempotency-key <key>", "stable idempotency key")
    .option("--source <source>", "override the source bound to the key")
    .option("--profile <name>")
    .action(
      async (
        eventType: string,
        options: { user: string; data: string; idempotencyKey?: string; source?: string; profile?: string },
      ) => {
        const json = program.opts().json === true;
        const profile = resolveProfile({ profile: options.profile });
        const source = options.source ?? sourceForEventType(eventType, profile.source);
        const client = clientFor(profile, source);
        const event: IngestEvent = {
          type: eventType,
          schema_version: 1,
          recipient: { external_id: options.user },
          idempotency_key: options.idempotencyKey ?? `${eventType}:${options.user}:${newId()}`,
          data: parseData(options.data),
        };
        const response = await client.sendEvent(event);

        if (json) {
          printJson(response);
          return;
        }

        ok(`accepted ${response.data.notification_id}`);
        info(`trace ${response.data.trace_id}${response.data.duplicate ? " (duplicate)" : ""}`);
      },
    );

  program
    .command("batch <file>")
    .description("send up to 1,000 events from a JSON file or stdin")
    .option("--profile <name>")
    .action(async (file: string, options: { profile?: string }) => {
      const json = program.opts().json === true;
      const profile = resolveProfile({ profile: options.profile });
      const raw = readFileSync(file === "-" ? 0 : file, "utf8");
      const parsed: unknown = JSON.parse(raw);
      const list = Array.isArray(parsed)
        ? parsed
        : typeof parsed === "object" && parsed !== null && "events" in parsed
          ? (parsed as { events: unknown[] }).events
          : null;

      if (!Array.isArray(list)) {
        throw new Error("File must contain an array or an object with an events array");
      }

      const bySource = new Map<string, IngestEvent[]>();
      const invalid: Array<{ index: number; message: string }> = [];

      for (const [index, item] of list.entries()) {
        const event = IngestEventSchema.safeParse(item);

        if (!event.success) {
          invalid.push({ index, message: event.error.issues[0]?.message ?? "invalid event" });
          continue;
        }

        const source = sourceForEventType(event.data.type, profile.source);
        const existing = bySource.get(source) ?? [];
        existing.push(event.data);
        bySource.set(source, existing);
      }

      const output: Array<Record<string, unknown>> = [];

      for (const [source, events] of bySource) {
        const response = await clientFor(profile, source).sendBatch(events);
        output.push({ source, ...response.data });
      }

      if (json) {
        printJson({ output, invalid });
        return;
      }

      for (const group of output) {
        printTable(
          ["source", "accepted", "rejected"],
          [[String(group["source"]), Number(group["accepted"]), Number(group["rejected"])]],
        );
      }

      if (invalid.length > 0) {
        fail(`${invalid.length} events failed local validation`);
      }
    });

  program
    .command("simulate <event-type>")
    .description("generate synthetic events at a fixed rate")
    .requiredOption("--users <n>", "distinct recipient count", "100")
    .option("--rate <events-per-second>", "send rate", "20")
    .option("--duration <seconds>", "run duration", "10")
    .option("--source <source>")
    .option("--profile <name>")
    .action(
      async (
        eventType: string,
        options: { users: string; rate: string; duration: string; source?: string; profile?: string },
      ) => {
        const profile = resolveProfile({ profile: options.profile });
        const source = options.source ?? sourceForEventType(eventType, profile.source);
        const client = clientFor(profile, source);
        const users = Math.max(1, Number(options.users));
        const rate = Math.max(1, Number(options.rate));
        const duration = Math.max(1, Number(options.duration));
        const total = rate * duration;
        let sent = 0;
        let failed = 0;
        const started = Date.now();

        for (let index = 0; index < total; index += 1) {
          const externalId = `cust_${String((index % users) + 1).padStart(5, "0")}`;

          try {
            await client.sendEvent({
              type: eventType,
              schema_version: 1,
              recipient: { external_id: externalId },
              idempotency_key: `simulate:${eventType}:${Date.now()}:${index}`,
              data: {
                booking_id: `bkg_sim_${index}`,
                service: "plumbing",
                pro_name: "Ravi",
                scheduled_for: "2026-11-02T10:00:00+05:30",
                address_label: "Home",
              },
            });
            sent += 1;
          } catch {
            failed += 1;
          }

          await sleep(Math.max(0, 1000 / rate - (Date.now() - started - (index * 1000) / rate)));
        }

        ok(`sent ${sent} events, ${failed} failed in ${Math.round((Date.now() - started) / 1000)}s`);
      },
    );
};
