import type { Command } from "commander";

import { resolveProfile } from "../config";
import { check, fail, heading, info, ok, printJson } from "../output";

interface Whoami {
  kind: string;
  name?: string;
  source?: string;
  scopes?: string[];
  user_id?: string;
}

export const registerDoctor = (program: Command): void => {
  program
    .command("doctor")
    .description("check API, auth, source, dependencies, and clock skew")
    .option("--profile <name>")
    .action(async (options: { profile?: string }) => {
      const json = program.opts().json === true;
      const profile = resolveProfile({ profile: options.profile });
      const result = {
        api: false,
        auth: false,
        source_match: false,
        clock_skew_seconds: 0,
        checks: {} as Record<string, boolean>,
      };

      heading("herald doctor");

      try {
        const response = await fetch(`${profile.apiUrl}/health/ready`);
        const body = (await response.json()) as { checks?: Record<string, boolean> };
        result.checks = body.checks ?? {};
        result.api = response.ok;

        const serverDate = response.headers.get("date");
        if (serverDate) {
          result.clock_skew_seconds = Math.abs(Date.now() - new Date(serverDate).getTime()) / 1000;
        }
      } catch {
        result.api = false;
      }

      check(result.api, "api reachable", profile.apiUrl);

      for (const [name, value] of Object.entries(result.checks)) {
        check(value, `dependency: ${name}`);
      }

      check(result.clock_skew_seconds < 60, "clock skew", `${result.clock_skew_seconds.toFixed(1)}s`);

      try {
        const response = await fetch(`${profile.apiUrl}/v1/whoami`, {
          headers: { authorization: `Bearer ${profile.apiKey}` },
        });

        if (response.ok) {
          const who = (await response.json()) as { data: Whoami };
          result.auth = true;
          result.source_match = who.data.source === profile.source;
          check(true, "authentication", `${who.data.kind} ${who.data.name ?? who.data.user_id ?? ""}`);
          check(result.source_match, "source matches profile", `${who.data.source ?? "user token"}`);
        } else {
          check(false, "authentication", `HTTP ${response.status}`);
        }
      } catch {
        check(false, "authentication", "request failed");
      }

      if (json) {
        printJson(result);
        return;
      }

      if (result.api && result.auth) {
        ok("doctor found no blocking problems");
      } else {
        fail("doctor found a problem; start the stack with make demo and re-run");
        process.exitCode = 1;
      }

      info("next: herald health");
    });
};
