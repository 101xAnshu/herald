import type { CampaignCreate } from "@herald/contracts";
import type { Command } from "commander";

import { clientFor } from "../client";
import { resolveProfile } from "../config";
import { info, ok, printJson, printTable } from "../output";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const audienceFrom = (value: string): CampaignCreate["audience"] => {
  const parsed: unknown = JSON.parse(value);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("--audience must be a JSON object");
  }

  return parsed as CampaignCreate["audience"];
};

const printStats = (stats: {
  status: string;
  total: number;
  pending: number;
  queued: number;
  sent: number;
  delivered: number;
  failed: number;
  suppressed: number;
  canceled: number;
  progress_ratio: number;
}): void => {
  const percent = (stats.progress_ratio * 100).toFixed(1);
  process.stdout.write(
    `${stats.status.padEnd(10)} ${percent.padStart(5)}%  total ${stats.total}  queued ${stats.queued}  sent ${stats.sent}  delivered ${stats.delivered}  failed ${stats.failed}  suppressed ${stats.suppressed}\n`,
  );
};

export const registerCampaignCommands = (program: Command): void => {
  const campaign = program.command("campaign").description("create and operate campaigns");

  campaign
    .command("create")
    .description("create a campaign")
    .requiredOption("--name <name>")
    .requiredOption("--template <template-id>")
    .requiredOption("--channel <channel>")
    .requiredOption("--audience <json>", "audience filter as JSON")
    .option("--schedule <iso>")
    .option("--data <json>", "template variables as JSON")
    .option("--rate <events-per-second>")
    .option("--profile <name>")
    .action(
      async (options: {
        name: string;
        template: string;
        channel: CampaignCreate["channel"];
        audience: string;
        schedule?: string;
        data?: string;
        rate?: string;
        profile?: string;
      }) => {
        const json = program.opts().json === true;
        const profile = resolveProfile({ profile: options.profile });
        const response = await clientFor(profile).createCampaign({
          name: options.name,
          template_id: options.template,
          channel: options.channel,
          audience: audienceFrom(options.audience),
          payload: options.data ? (JSON.parse(options.data) as Record<string, unknown>) : {},
          scheduled_for: options.schedule ?? null,
          rate_limit: options.rate ? Number(options.rate) : undefined,
        });

        if (json) {
          printJson(response);
          return;
        }

        ok(`campaign ${response.data.id} created`);
      },
    );

  campaign
    .command("list")
    .description("list campaigns")
    .option("--profile <name>")
    .action(async (options: { profile?: string }) => {
      const json = program.opts().json === true;
      const profile = resolveProfile({ profile: options.profile });
      const response = await clientFor(profile).listCampaigns();

      if (json) {
        printJson(response);
        return;
      }

      printTable(
        ["id", "name", "channel", "status", "rate", "created"],
        response.data.map((item) => [
          item.id,
          item.name,
          item.channel,
          item.status,
          item.rate_limit,
          item.created_at,
        ]),
      );
    });

  campaign
    .command("show <id>")
    .description("show one campaign")
    .option("--profile <name>")
    .action(async (id: string, options: { profile?: string }) => {
      const json = program.opts().json === true;
      const profile = resolveProfile({ profile: options.profile });
      const response = await clientFor(profile).getCampaign(id);

      if (json) {
        printJson(response);
        return;
      }

      printTable(
        ["field", "value"],
        Object.entries(response.data).map(([key, value]) => [
          key,
          typeof value === "object" ? JSON.stringify(value) : String(value),
        ]),
      );
    });

  for (const action of ["launch", "pause", "resume", "cancel"] as const) {
    campaign
      .command(`${action} <id>`)
      .description(`${action} a campaign`)
      .option("--profile <name>")
      .action(async (id: string, options: { profile?: string }) => {
        const profile = resolveProfile({ profile: options.profile });
        const response = await clientFor(profile).campaignAction(id, action);
        ok(`campaign ${id} is ${response.data.status}`);
      });
  }

  campaign
    .command("stats <id>")
    .description("show the campaign funnel")
    .option("--profile <name>")
    .action(async (id: string, options: { profile?: string }) => {
      const json = program.opts().json === true;
      const profile = resolveProfile({ profile: options.profile });
      const response = await clientFor(profile).getCampaignStats(id);

      if (json) {
        printJson(response);
        return;
      }

      printStats(response.data);
    });

  campaign
    .command("watch <id>")
    .description("follow campaign progress")
    .option("--interval <ms>", "poll interval", "2000")
    .option("--profile <name>")
    .action(async (id: string, options: { interval: string; profile?: string }) => {
      const profile = resolveProfile({ profile: options.profile });
      const client = clientFor(profile);
      const interval = Math.max(500, Number(options.interval));

      for (;;) {
        const response = await client.getCampaignStats(id);
        printStats(response.data);

        if (["completed", "canceled", "failed"].includes(response.data.status)) {
          info("campaign is terminal");
          return;
        }

        await sleep(interval);
      }
    });
};
