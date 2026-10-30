import type { Command } from "commander";

import { userClient } from "../client";
import { resolveProfile } from "../config";
import { ok, printJson, printTable, relativeTime } from "../output";

export const registerInboxCommands = (program: Command): void => {
  const inbox = program.command("inbox").description("read the consumer inbox");

  inbox
    .command("list")
    .description("list inbox items")
    .requiredOption("--user <external-id>")
    .option("--unread", "only unread items")
    .option("--limit <n>", "page size", "20")
    .option("--cursor <cursor>")
    .option("--profile <name>")
    .action(
      async (options: {
        user: string;
        unread?: boolean;
        limit: string;
        cursor?: string;
        profile?: string;
      }) => {
        const json = program.opts().json === true;
        const profile = resolveProfile({ profile: options.profile });
        const client = await userClient(profile, options.user);
        const page = await client.listInbox({
          limit: Number(options.limit),
          cursor: options.cursor,
          unread: options.unread,
        });

        if (json) {
          printJson(page);
          return;
        }

        printTable(
          ["id", "source", "title", "read", "created"],
          page.items.map((item) => [
            item.id,
            item.source,
            item.title,
            item.read_at ? "yes" : "no",
            relativeTime(item.created_at),
          ]),
        );
      },
    );

  inbox
    .command("watch")
    .description("stream new inbox items")
    .requiredOption("--user <external-id>")
    .option("--profile <name>")
    .action(async (options: { user: string; profile?: string }) => {
      const profile = resolveProfile({ profile: options.profile });
      const client = await userClient(profile, options.user);
      process.stdout.write("watching inbox, press Ctrl+C to stop\n");

      for await (const item of client.streamInbox()) {
        process.stdout.write(
          `${relativeTime(item.created_at).padEnd(8)} ${item.source.padEnd(8)} ${item.title}\n`,
        );
      }
    });

  inbox
    .command("read <item-id>")
    .description("mark one inbox item read")
    .requiredOption("--user <external-id>")
    .option("--profile <name>")
    .action(async (itemId: string, options: { user: string; profile?: string }) => {
      const profile = resolveProfile({ profile: options.profile });
      const client = await userClient(profile, options.user);
      await client.markInboxRead(itemId);
      ok(`marked ${itemId} read`);
    });
};
