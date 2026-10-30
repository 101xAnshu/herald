import type { Command } from "commander";

import { readConfig, resolveProfile, writeConfig } from "../config";
import { info, printJson, printTable } from "../output";

const mask = (value: string): string =>
  value ? `${value.slice(0, 12)}${"*".repeat(Math.max(0, Math.min(12, value.length - 12)))}` : "";

export const registerConfigCommands = (program: Command): void => {
  const config = program.command("config").description("inspect or edit the CLI profile");

  config
    .command("list")
    .description("list profiles")
    .action(() => {
      const json = program.opts().json === true;
      const current = readConfig();

      if (json) {
        printJson(current);
        return;
      }

      printTable(
        ["profile", "api_url", "source", "api_key"],
        Object.entries(current.profiles).map(([name, profile]) => [
          name,
          profile.apiUrl,
          profile.source,
          mask(profile.apiKey),
        ]),
      );
    });

  config
    .command("get <key>")
    .description("read one profile value")
    .option("--profile <name>")
    .action((key: string, options: { profile?: string }) => {
      const profile = resolveProfile({ profile: options.profile });
      const mapping: Record<string, string> = {
        api_url: profile.apiUrl,
        api_key: profile.apiKey,
        source: profile.source,
        profile: profile.name,
      };

      if (!(key in mapping)) {
        throw new Error(`Unknown config key ${key}`);
      }

      process.stdout.write(`${key === "api_key" ? mask(mapping[key] ?? "") : mapping[key]}\n`);
    });

  config
    .command("set <key> <value>")
    .description("write one profile value")
    .option("--profile <name>")
    .action((key: string, value: string, options: { profile?: string }) => {
      const profile = resolveProfile({ profile: options.profile });
      const config = readConfig();

      if (!["api_url", "api_key", "source"].includes(key)) {
        throw new Error(`Unknown config key ${key}`);
      }

      config.profiles[profile.name] = {
        apiUrl: key === "api_url" ? value : profile.apiUrl,
        apiKey: key === "api_key" ? value : profile.apiKey,
        source: key === "source" ? value : profile.source,
        keys: profile.keys ?? {},
      };
      writeConfig(config);
      info(`${key} updated for ${profile.name}`);
    });
};
