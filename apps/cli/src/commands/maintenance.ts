import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

import type { Command } from "commander";

import { runRetention } from "@herald/db";

import { repoRoot } from "../config";
import { info, ok, printJson } from "../output";

const run = (args: string[], env: NodeJS.ProcessEnv = {}): void => {
  const result = spawnSync("pnpm", args, {
    cwd: repoRoot(),
    stdio: "inherit",
    env: { ...process.env, ...env },
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: pnpm ${args.join(" ")}`);
  }
};

export const registerMaintenanceCommands = (program: Command): void => {
  program
    .command("seed")
    .description("seed deterministic Marlowe data")
    .option("--scale <scale>", "small or load", "small")
    .action((options: { scale: string }) => {
      run(["--filter", "@herald/db", "prisma:seed"], { SEED_SCALE: options.scale });
      ok(`seeded ${options.scale} dataset`);
    });

  const retention = program.command("retention").description("run the retention job");

  retention
    .command("run")
    .description("delete expired rows, or list what would be deleted")
    .option("--dry-run", "count without deleting")
    .action(async (options: { dryRun?: boolean }) => {
      const result = await runRetention({ dryRun: options.dryRun });
      printJson(result);
      ok(options.dryRun ? "retention dry run complete" : "retention complete");
    });

  program
    .command("reset")
    .description("drop and recreate the demo database")
    .option("--yes", "skip the confirmation prompt")
    .action(async (options: { yes?: boolean }) => {
      if (!options.yes) {
        const prompt = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await prompt.question("This drops the local Herald database. Type reset to continue: ");
        prompt.close();

        if (answer.trim() !== "reset") {
          info("aborted");
          return;
        }
      }

      run(["--filter", "@herald/db", "exec", "prisma", "migrate", "reset", "--force", "--skip-seed"]);
      run(["--filter", "@herald/db", "prisma:seed"], { SEED_SCALE: "small" });
      ok("database reset and reseeded");
    });
};
