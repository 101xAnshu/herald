import type { Command } from "commander";

import { clientFor, sourceForEventType } from "../client";
import { resolveProfile } from "../config";
import { check, fail, heading, info, ok, printTable } from "../output";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async <T>(
  label: string,
  action: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;

  while (Date.now() < deadline) {
    last = await action();

    if (predicate(last)) {
      return last;
    }

    await sleep(1000);
  }

  throw new Error(`Timed out waiting for ${label}`);
};

interface TemplateRow {
  id: string;
  key: string;
  channel: string;
  locale: string;
  current_version: { id: string } | null;
}

interface Stats {
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
}

export const registerDemoCommand = (program: Command): void => {
  program
    .command("demo")
    .description("run the scripted end-to-end walkthrough")
    .option("--fast", "use a higher campaign rate")
    .option("--profile <name>")
    .action(async (options: { fast?: boolean; profile?: string }) => {
      const profile = resolveProfile({ profile: options.profile });
      const ops = clientFor(profile);

      heading("Herald demo");
      info(`api ${profile.apiUrl}`);

      const ready = await fetch(`${profile.apiUrl}/health/ready`);

      if (!ready.ok) {
        fail(`API is not ready (${ready.status}). Run make demo first.`);
        process.exitCode = 1;
        return;
      }

      ok("API and dependencies are ready");
      process.stdout.write("\n");

      heading("1. Transactional booking event");
      const bookingSource = sourceForEventType("booking.confirmed", "booking");
      const booking = await clientFor(profile, bookingSource).sendEvent({
        type: "booking.confirmed",
        schema_version: 1,
        recipient: { external_id: "cust_00001" },
        idempotency_key: `demo:booking:${Date.now()}`,
        data: {
          booking_id: "bkg_demo_8821",
          service: "plumbing",
          pro_name: "Ravi",
          scheduled_for: "2026-11-02T10:00:00+05:30",
          address_label: "Home",
        },
      });

      ok(`accepted ${booking.data.notification_id}`);
      info(`trace ${booking.data.trace_id}`);

      const trace = await waitFor(
        "the booking notification to finish",
        () => ops.getTrace(booking.data.notification_id),
        (response) => ["delivered", "partially_delivered", "failed", "suppressed"].includes(response.data.notification.status),
        30_000,
      );

      printTable(
        ["channel", "status", "provider"],
        trace.data.deliveries.map((delivery) => [delivery.channel, delivery.status, delivery.provider]),
      );
      process.stdout.write("\n");

      heading("2. Winback campaign");
      const templates = await ops.request<Array<TemplateRow>>("GET", "/v1/catalog/templates");
      const template = templates.data.find(
        (row) => row.key === "winback" && row.channel === "email" && row.locale === "en",
      );

      if (!template?.current_version) {
        throw new Error("winback email template is missing; run herald seed");
      }

      const campaign = await ops.createCampaign({
        name: `demo winback ${new Date().toISOString().slice(11, 19)}`,
        template_id: template.id,
        channel: "email",
        audience: {
          kinds: ["customer"],
          city: "Pune",
          inactive_days: 30,
          marketing_opt_in: true,
        },
        payload: { offer: "20 percent off your next cleaning" },
        scheduled_for: null,
        rate_limit: options.fast ? 200 : 100,
      });

      ok(`campaign ${campaign.data.id} created`);
      await ops.campaignAction(campaign.data.id, "launch");

      const beforePause = await waitFor(
        "400 queued recipients",
        () => ops.getCampaignStats(campaign.data.id),
        (response) => response.data.queued + response.data.sent + response.data.delivered >= 400,
        60_000,
      );

      await ops.campaignAction(campaign.data.id, "pause");
      ok(
        `paused at ${beforePause.data.queued + beforePause.data.sent + beforePause.data.delivered} recipients`,
      );
      await sleep(1500);

      await ops.campaignAction(campaign.data.id, "resume");
      info("resumed campaign");

      const finished = await waitFor(
        "the campaign to complete",
        () => ops.getCampaignStats(campaign.data.id),
        (response) => ["completed", "canceled", "failed"].includes(response.data.status),
        120_000,
      );

      const stats: Stats = finished.data;
      check(stats.status === "completed", "campaign finished", stats.status);
      printTable(
        ["total", "queued", "sent", "delivered", "failed", "suppressed"],
        [[stats.total, stats.queued, stats.sent, stats.delivered, stats.failed, stats.suppressed]],
      );
      process.stdout.write("\n");

      heading("Where to look");
      info(`API        ${profile.apiUrl}`);
      info(`API docs   ${profile.apiUrl}/docs`);
      info(`Metrics    ${profile.apiUrl}/metrics`);
      info("Mailpit    http://localhost:8025");

      info("Open Mailpit to inspect the campaign emails");

      ok("demo complete");
    });
};
