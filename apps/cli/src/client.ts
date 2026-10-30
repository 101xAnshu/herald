import { EVENT_CATALOG } from "@herald/contracts";
import { HeraldClient } from "@herald/sdk";

import { apiKeyForSource, type ResolvedProfile } from "./config";

export const clientFor = (profile: ResolvedProfile, source?: string): HeraldClient => {
  const key = source ? apiKeyForSource(profile, source) : profile.apiKey;

  return new HeraldClient({
    baseUrl: profile.apiUrl,
    apiKey: key,
    timeoutMs: 15_000,
  });
};

export const sourceForEventType = (eventType: string, fallback: string): string => {
  const definition = EVENT_CATALOG.find((candidate) => candidate.key === eventType);
  return definition?.allowed_sources[0] ?? fallback;
};

export const userClient = async (
  profile: ResolvedProfile,
  externalId: string,
): Promise<HeraldClient> => {
  const token = await clientFor(profile).demoToken(externalId);
  return new HeraldClient({
    baseUrl: profile.apiUrl,
    userToken: token.data.access_token,
    timeoutMs: 15_000,
  });
};
