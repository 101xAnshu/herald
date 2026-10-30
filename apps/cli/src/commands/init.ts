import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Command } from "commander";

import { demoEnv, readConfig, repoRoot, writeConfig, type Profile } from "../config";
import { check, info, ok, warn } from "../output";

export const registerInit = (program: Command): void => {
  program
    .command("init")
    .description("verify connectivity and store an API profile")
    .option("--profile <name>", "profile name", "local")
    .option("--api-url <url>", "API base URL")
    .option("--api-key <key>", "service API key")
    .option("--source <source>", "source bound to the key")
    .option("--demo", "read the local demo credentials")
    .action(
      async (options: { profile: string; apiUrl?: string; apiKey?: string; source?: string; demo?: boolean }) => {
        const demo = options.demo ? demoEnv() : {};
        const demoPath = join(repoRoot(), ".herald", "demo.env");

        if (options.demo && !existsSync(demoPath)) {
          warn("no .herald/demo.env found, run make demo or herald seed first");
        }

        const apiUrl = options.apiUrl ?? demo["HERALD_API_URL"] ?? "http://localhost:3000";
        const apiKey = options.apiKey ?? demo["HERALD_OPS_API_KEY"] ?? process.env["HERALD_API_KEY"] ?? "";
        const source = options.source ?? "ops";

        if (!apiKey) {
          throw new Error("An API key is required. Pass --api-key or use --demo.");
        }

        const keys: Record<string, string> = {};

        for (const [key, value] of Object.entries(demo)) {
          if (key.startsWith("HERALD_") && key.endsWith("_API_KEY") && key !== "HERALD_OPS_API_KEY") {
            const name = key.slice("HERALD_".length, -"_API_KEY".length).toLowerCase();
            keys[name] = value;
          }
        }

        const profile: Profile = { apiUrl, apiKey, source, keys };
        const config = readConfig();
        config.profiles[options.profile] = profile;
        config.defaultProfile = options.profile;
        const path = writeConfig(config);

        ok(`profile "${options.profile}" written to ${path}`);
        info(`api ${apiUrl}`);
        info(`key ${apiKey.slice(0, 20)}...`);
        check(true, "profile stored");

        try {
          const response = await fetch(`${apiUrl}/health/ready`);

          if (response.ok) {
            ok("api is ready");
          } else {
            warn(`api returned ${response.status}; run make demo`);
          }
        } catch {
          warn(`api is not reachable at ${apiUrl}; run make demo`);
        }

        process.stdout.write("\nNext: herald doctor\n");
      },
    );
};
