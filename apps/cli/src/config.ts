import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse as parsePath, resolve } from "node:path";

import TOML from "@iarna/toml";

export interface Profile {
  apiUrl: string;
  apiKey: string;
  source: string;
  keys?: Record<string, string>;
}

interface RawProfile {
  api_url?: string;
  api_key?: string;
  source?: string;
  keys?: Record<string, string>;
}

interface RawConfig {
  default_profile?: string;
  profiles?: Record<string, RawProfile>;
}

export interface CliConfig {
  defaultProfile: string;
  profiles: Record<string, Profile>;
}

export const configPath = (): string =>
  process.env["HERALD_CONFIG"] ??
  join(process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"), "herald", "config.toml");

export const readConfig = (): CliConfig => {
  const path = configPath();

  if (!existsSync(path)) {
    return { defaultProfile: "local", profiles: {} };
  }

  const raw = TOML.parse(readFileSync(path, "utf8")) as unknown as RawConfig;
  const profiles: Record<string, Profile> = {};

  for (const [name, profile] of Object.entries(raw.profiles ?? {})) {
    profiles[name] = {
      apiUrl: profile.api_url ?? "http://localhost:3000",
      apiKey: profile.api_key ?? "",
      source: profile.source ?? "ops",
      keys: profile.keys ?? {},
    };
  }

  return { defaultProfile: raw.default_profile ?? "local", profiles };
};

export const writeConfig = (config: CliConfig): string => {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  const payload = TOML.stringify({
    default_profile: config.defaultProfile,
    profiles: Object.fromEntries(
      Object.entries(config.profiles).map(([name, profile]) => [
        name,
        {
          api_url: profile.apiUrl,
          api_key: profile.apiKey,
          source: profile.source,
          keys: profile.keys ?? {},
        },
      ]),
    ),
  } as TOML.JsonMap);

  writeFileSync(path, payload, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
};

export interface ResolvedProfile extends Profile {
  name: string;
}

export const resolveProfile = (options: {
  profile?: string;
  apiUrl?: string;
  apiKey?: string;
  source?: string;
}): ResolvedProfile => {
  const config = readConfig();
  const name = options.profile ?? process.env["HERALD_PROFILE"] ?? config.defaultProfile;
  const stored = config.profiles[name];

  if (!stored && !process.env["HERALD_API_URL"] && !options.apiUrl) {
    throw new Error(
      `Profile "${name}" is not configured. Run "herald init --demo" or "herald init --api-url ... --api-key ...".`,
    );
  }

  return {
    name,
    apiUrl: options.apiUrl ?? process.env["HERALD_API_URL"] ?? stored?.apiUrl ?? "http://localhost:3000",
    apiKey: options.apiKey ?? process.env["HERALD_API_KEY"] ?? stored?.apiKey ?? "",
    source: options.source ?? process.env["HERALD_SOURCE"] ?? stored?.source ?? "ops",
    keys: stored?.keys ?? {},
  };
};

export const apiKeyForSource = (profile: Profile, source: string): string =>
  profile.keys?.[source] ?? profile.apiKey;

export const repoRoot = (): string => {
  let directory = process.cwd();

  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(directory, "pnpm-workspace.yaml"))) {
      return directory;
    }

    const parent = dirname(directory);

    if (parent === directory || directory === parsePath(directory).root) {
      break;
    }

    directory = parent;
  }

  return resolve(process.cwd());
};

export const demoEnv = (): Record<string, string> => {
  const path = join(repoRoot(), ".herald", "demo.env");

  if (!existsSync(path)) {
    return {};
  }

  const values: Record<string, string> = {};

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const separator = line.indexOf("=");

    if (separator === -1) {
      continue;
    }

    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }

  return values;
};
