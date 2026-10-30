#!/usr/bin/env node
import { Command } from "commander";

import { registerCampaignCommands } from "./commands/campaign";
import { registerCompletionCommand } from "./commands/completion";
import { registerConfigCommands } from "./commands/config";
import { registerDemoCommand } from "./commands/demo";
import { registerDoctor } from "./commands/doctor";
import { registerInboxCommands } from "./commands/inbox";
import { registerInit } from "./commands/init";
import { registerMaintenanceCommands } from "./commands/maintenance";
import { registerNotificationCommands } from "./commands/notifications";
import { registerOpsCommands } from "./commands/ops";
import { registerSendCommands } from "./commands/send";
import { registerVersionCommand } from "./commands/version";
import { fail } from "./output";

const program = new Command();

program
  .name("herald")
  .description("Herald notification platform CLI")
  .version("0.1.0")
  .option("--json", "print machine-readable output")
  .showHelpAfterError();

registerInit(program);
registerDoctor(program);
registerConfigCommands(program);
registerVersionCommand(program);
registerCompletionCommand(program);
registerMaintenanceCommands(program);
registerDemoCommand(program);
registerSendCommands(program);
registerNotificationCommands(program);
registerInboxCommands(program);
registerCampaignCommands(program);
registerOpsCommands(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
