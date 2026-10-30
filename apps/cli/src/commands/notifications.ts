import type { Command } from "commander";

import { clientFor } from "../client";
import { resolveProfile } from "../config";
import { heading, info, printJson, printTable, relativeTime } from "../output";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const registerNotificationCommands = (program: Command): void => {
  const notifications = program.command("notifications").description("inspect notifications");

  notifications
    .command("list")
    .description("list notifications")
    .option("--source <source>")
    .option("--status <status>")
    .option("--user <user-id>")
    .option("--since <iso>")
    .option("--limit <n>", "page size", "20")
    .option("--cursor <cursor>")
    .option("--profile <name>")
    .action(
      async (options: {
        source?: string;
        status?: string;
        user?: string;
        since?: string;
        limit: string;
        cursor?: string;
        profile?: string;
      }) => {
        const json = program.opts().json === true;
        const profile = resolveProfile({ profile: options.profile });
        const response = await clientFor(profile).listNotifications({
          source: options.source,
          status: options.status,
          user_id: options.user,
          since: options.since,
          limit: Number(options.limit),
          cursor: options.cursor,
        });

        if (json) {
          printJson(response);
          return;
        }

        printTable(
          ["id", "source", "type", "priority", "status", "created"],
          response.data.map((item) => [
            item.id,
            item.source,
            item.event_type,
            item.priority,
            item.status,
            relativeTime(item.created_at),
          ]),
        );

        if (response.meta?.has_more) {
          info(`next cursor: ${response.meta.next_cursor}`);
        }
      },
    );

  const traceAction = async (id: string, options: { profile?: string }) => {
    const json = program.opts().json === true;
    const profile = resolveProfile({ profile: options.profile });
    const response = await clientFor(profile).getTrace(id);

    if (json) {
      printJson(response);
      return;
    }

    const trace = response.data;
    heading(`${trace.notification.event_type}  ${trace.notification.id}`);
    info(
      `${trace.notification.source}  ${trace.notification.priority}  ${trace.notification.status}  ${trace.notification.created_at}`,
    );
    process.stdout.write("\n");

    printTable(
      ["time", "kind", "channel", "status", "attempt", "detail"],
      trace.timeline.map((entry) => [
        entry.at.slice(11, 23),
        entry.kind,
        entry.channel ?? "-",
        entry.status ?? "-",
        entry.attempt ?? "-",
        JSON.stringify(entry.detail).slice(0, 80),
      ]),
    );
  };

  notifications
    .command("trace <id>")
    .description("show the full timeline for one notification")
    .option("--profile <name>")
    .action(traceAction);

  program
    .command("trace <id>")
    .description("show the full timeline for one notification")
    .option("--profile <name>")
    .action(traceAction);

  program
    .command("tail")
    .description("follow new notifications")
    .option("--source <source>")
    .option("--channel <channel>")
    .option("--profile <name>")
    .action(async (options: { source?: string; channel?: string; profile?: string }) => {
      const profile = resolveProfile({ profile: options.profile });
      const client = clientFor(profile);
      const seen = new Set<string>();

      process.stdout.write("following notifications, press Ctrl+C to stop\n");

      for (;;) {
        const response = await client.listNotifications({
          source: options.source,
          limit: 50,
        });

        for (const item of [...response.data].reverse()) {
          if (seen.has(item.id)) {
            continue;
          }

          seen.add(item.id);

          if (options.channel) {
            const trace = await client.getTrace(item.id);
            const matches = trace.data.deliveries.some(
              (delivery) => delivery.channel === options.channel,
            );

            if (!matches) {
              continue;
            }
          }

          process.stdout.write(
            `${relativeTime(item.created_at).padEnd(8)} ${item.source.padEnd(8)} ${item.event_type.padEnd(24)} ${item.status.padEnd(18)} ${item.id}\n`,
          );
        }

        await sleep(2000);
      }
    });
};
