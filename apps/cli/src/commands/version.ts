import type { Command } from "commander";

import { resolveProfile } from "../config";
import { printJson } from "../output";

const CLI_VERSION = "0.1.0";

export const registerVersionCommand = (program: Command): void => {
  program
    .command("version")
    .description("print CLI, API, and schema versions")
    .option("--profile <name>")
    .action(async (options: { profile?: string }) => {
      const json = program.opts().json === true;
      let api = "unreachable";

      try {
        const profile = resolveProfile({ profile: options.profile });
        const response = await fetch(`${profile.apiUrl}/openapi.json`);
        const document = (await response.json()) as { info?: { version?: string } };
        api = document.info?.version ?? "unknown";
      } catch {
        api = "unreachable";
      }

      const result = { cli: CLI_VERSION, api, schema_version: 1 };

      if (json) {
        printJson(result);
        return;
      }

      process.stdout.write(`cli ${result.cli}\napi ${result.api}\nschema ${result.schema_version}\n`);
    });
};
