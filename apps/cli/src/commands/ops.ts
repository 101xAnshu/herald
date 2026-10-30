import type { ApiKeyCreate } from "@herald/contracts";
import type { Command } from "commander";

import { clientFor } from "../client";
import { resolveProfile } from "../config";
import { check, heading, info, ok, printJson, printTable, warn } from "../output";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const registerOpsCommands = (program: Command): void => {
  program
    .command("health")
    .description("check dependencies and pipeline health")
    .option("--watch", "refresh every 5 seconds")
    .option("--profile <name>")
    .action(async (options: { watch?: boolean; profile?: string }) => {
      const json = program.opts().json === true;
      const profile = resolveProfile({ profile: options.profile });
      const client = clientFor(profile);

      for (;;) {
        const response = await fetch(`${profile.apiUrl}/health/ready`);
        const body = (await response.json()) as { status: string; checks: Record<string, boolean> };
        const stats = await client.request<Record<string, unknown>>("GET", "/v1/ops/stats").catch(() => null);

        if (json) {
          printJson({ health: body, stats: stats?.data });
        } else {
          heading("herald health");
          check(response.ok, "ready", body.status);

          for (const [name, value] of Object.entries(body.checks ?? {})) {
            check(value, name);
          }

          if (stats) {
            const data = stats.data as {
              notifications?: Record<string, number>;
              outbox?: { pending: number; oldest_age_seconds: number };
              dlq?: { depth: number };
              retries?: { due: number };
            };

            info(
              `outbox ${data.outbox?.pending ?? 0} pending, oldest ${data.outbox?.oldest_age_seconds ?? 0}s`,
            );
            info(`dlq ${data.dlq?.depth ?? 0}, due retries ${data.retries?.due ?? 0}`);
            info(
              `notifications ${Object.entries(data.notifications ?? {})
                .map(([status, count]) => `${status}=${count}`)
                .join(" ")}`,
            );
          }
        }

        if (!options.watch) {
          return;
        }

        await sleep(5000);
      }
    });

  program
    .command("stats")
    .description("throughput, delivery outcomes, backlog, and retries")
    .option("--profile <name>")
    .action(async (options: { profile?: string }) => {
      const json = program.opts().json === true;
      const profile = resolveProfile({ profile: options.profile });
      const response = await clientFor(profile).request<Record<string, unknown>>("GET", "/v1/ops/stats");

      if (json) {
        printJson(response);
        return;
      }

      const data = response.data as {
        notifications: Record<string, number>;
        deliveries: Record<string, number>;
        outbox: { pending: number; oldest_age_seconds: number };
        dlq: { depth: number };
        retries: { due: number };
        campaigns: { running: number };
      };

      printTable(
        ["metric", "value"],
        [
          ["outbox pending", data.outbox.pending],
          ["outbox oldest (s)", data.outbox.oldest_age_seconds],
          ["dlq depth", data.dlq.depth],
          ["due retries", data.retries.due],
          ["running campaigns", data.campaigns.running],
          ["notifications", JSON.stringify(data.notifications)],
          ["deliveries", JSON.stringify(data.deliveries)],
        ],
      );
    });

  const dlq = program.command("dlq").description("inspect and replay dead letters");

  dlq
    .command("list")
    .description("list dead letters")
    .option("--limit <n>", "page size", "20")
    .option("--profile <name>")
    .action(async (options: { limit: string; profile?: string }) => {
      const json = program.opts().json === true;
      const profile = resolveProfile({ profile: options.profile });
      const response = await clientFor(profile).request<Array<Record<string, unknown>>>(
        "GET",
        "/v1/ops/dlq",
        { query: { limit: Number(options.limit) } },
      );

      if (json) {
        printJson(response);
        return;
      }

      printTable(
        ["id", "topic", "attempts", "class", "code", "created"],
        response.data.map((item) => [
          String(item["id"]),
          String(item["topic"]),
          Number(item["attempts"]),
          String(item["error_class"]),
          String(item["error_code"] ?? "-"),
          String(item["created_at"]).slice(0, 19),
        ]),
      );
    });

  dlq
    .command("show <id>")
    .description("show one dead letter")
    .option("--profile <name>")
    .action(async (id: string, options: { profile?: string }) => {
      const profile = resolveProfile({ profile: options.profile });
      const response = await clientFor(profile).request("GET", `/v1/ops/dlq/${id}`);
      printJson(response.data);
    });

  dlq
    .command("replay <id>")
    .description("replay a dead letter (dry-run by default)")
    .option("--apply", "actually replay")
    .option("--profile <name>")
    .action(async (id: string, options: { apply?: boolean; profile?: string }) => {
      const profile = resolveProfile({ profile: options.profile });
      const response = await clientFor(profile).request("POST", `/v1/ops/dlq/${id}/replay`, {
        body: { dry_run: !options.apply },
      });
      printJson(response.data);
    });

  dlq
    .command("discard <id>")
    .description("discard a dead letter")
    .requiredOption("--reason <reason>")
    .option("--profile <name>")
    .action(async (id: string, options: { reason: string; profile?: string }) => {
      const profile = resolveProfile({ profile: options.profile });
      await clientFor(profile).request("DELETE", `/v1/ops/dlq/${id}`, {
        body: { reason: options.reason },
      });
      ok(`discarded ${id}`);
    });

  const source = program.command("source").description("pause or resume a source");

  source
    .command("pause <name>")
    .description("pause non-critical traffic for a source")
    .requiredOption("--reason <reason>")
    .option("--profile <name>")
    .action(async (name: string, options: { reason: string; profile?: string }) => {
      const profile = resolveProfile({ profile: options.profile });
      const response = await clientFor(profile).request("POST", `/v1/ops/sources/${name}/pause`, {
        body: { reason: options.reason },
      });
      printJson(response.data);
    });

  source
    .command("resume <name>")
    .description("resume a source")
    .requiredOption("--reason <reason>")
    .option("--profile <name>")
    .action(async (name: string, options: { reason: string; profile?: string }) => {
      const profile = resolveProfile({ profile: options.profile });
      const response = await clientFor(profile).request("POST", `/v1/ops/sources/${name}/resume`, {
        body: { reason: options.reason },
      });
      printJson(response.data);
    });

  const provider = program.command("provider").description("provider faults and budgets");

  provider
    .command("fault")
    .description("force a mock provider outcome")
    .requiredOption("--channel <channel>")
    .requiredOption("--outcome <outcome>", "accept, fail, timeout, or rate_limit")
    .option("--ttl <seconds>", "fault lifetime", "60")
    .option("--profile <name>")
    .action(async (options: { channel: string; outcome: string; ttl: string; profile?: string }) => {
      const profile = resolveProfile({ profile: options.profile });
      const response = await clientFor(profile).request("POST", "/v1/ops/providers/mock/fault", {
        body: {
          channel: options.channel,
          outcome: options.outcome,
          ttl_seconds: Number(options.ttl),
        },
      });
      printJson(response.data);
    });

  program
    .command("failover")
    .description("inspect the Postgres failover drill")
    .option("--dry-run", "validate replication without promoting")
    .option("--profile <name>")
    .action(async (options: { dryRun?: boolean; profile?: string }) => {
      const profile = resolveProfile({ profile: options.profile });
      const client = clientFor(profile);

      if (options.dryRun) {
        const response = await client.request("POST", "/v1/ops/failover/dry-run", { body: {} });
        printJson(response.data);
        return;
      }

      const response = await client.request("GET", "/v1/ops/failover");
      printJson(response.data);
    });

  const keys = program.command("keys").description("manage service API keys");

  keys
    .command("list")
    .description("list API keys")
    .option("--profile <name>")
    .action(async (options: { profile?: string }) => {
      const json = program.opts().json === true;
      const profile = resolveProfile({ profile: options.profile });
      const response = await clientFor(profile).request<Array<Record<string, unknown>>>(
        "GET",
        "/v1/admin/keys",
      );

      if (json) {
        printJson(response);
        return;
      }

      printTable(
        ["id", "name", "source", "prefix", "revoked", "expires"],
        response.data.map((item) => [
          String(item["id"]),
          String(item["name"]),
          String(item["source"]),
          String(item["prefix"]),
          item["revoked_at"] ? "yes" : "no",
          String(item["expires_at"] ?? "-").slice(0, 10),
        ]),
      );
    });

  keys
    .command("create")
    .description("create a service key")
    .requiredOption("--name <name>")
    .requiredOption("--source <source>")
    .requiredOption("--scopes <scopes>", "comma-separated scopes")
    .option("--expires-in-days <days>", "lifetime", "365")
    .option("--profile <name>")
    .action(
      async (options: {
        name: string;
        source: string;
        scopes: string;
        expiresInDays: string;
        profile?: string;
      }) => {
        const profile = resolveProfile({ profile: options.profile });
        const input = {
          name: options.name,
          source: options.source,
          scopes: options.scopes.split(",").map((scope) => scope.trim()),
          expires_in_days: Number(options.expiresInDays),
        } as ApiKeyCreate;
        const response = await clientFor(profile).createApiKey(input);
        warn("this key is shown once");
        printJson(response.data);
      },
    );

  keys
    .command("revoke <id>")
    .description("revoke a service key")
    .option("--profile <name>")
    .action(async (id: string, options: { profile?: string }) => {
      const profile = resolveProfile({ profile: options.profile });
      await clientFor(profile).request("DELETE", `/v1/admin/keys/${id}`);
      ok(`revoked ${id}`);
    });

  program
    .command("templates")
    .description("list templates and their current version IDs")
    .option("--profile <name>")
    .action(async (options: { profile?: string }) => {
      const json = program.opts().json === true;
      const profile = resolveProfile({ profile: options.profile });
      const response = await clientFor(profile).request<Array<Record<string, unknown>>>(
        "GET",
        "/v1/catalog/templates",
      );

      if (json) {
        printJson(response);
        return;
      }

      printTable(
        ["id", "key", "channel", "locale", "version", "status"],
        response.data.map((item) => [
          String(item["id"]),
          String(item["key"]),
          String(item["channel"]),
          String(item["locale"]),
          String((item["current_version"] as { version?: number } | null)?.version ?? "-"),
          String(item["status"]),
        ]),
      );
    });
};
