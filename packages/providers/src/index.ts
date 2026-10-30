import type { ChannelAdapter, ProviderStatusResolver } from "@herald/core";

import { createSmtpAdapter } from "./email";
import { MockAdapter } from "./mock";

export interface AdapterRegistry {
  get(channel: ChannelAdapter["channel"]): ChannelAdapter;
  all(): ChannelAdapter[];
}

export const createAdapterRegistry = (): AdapterRegistry => {
  const adapters: ChannelAdapter[] = [
    createSmtpAdapter(),
    new MockAdapter("in_app", "in_app"),
    new MockAdapter("mock_push", "push"),
    new MockAdapter("mock_sms", "sms"),
  ];

  const byChannel = new Map(adapters.map((adapter) => [adapter.channel, adapter]));

  return {
    get(channel) {
      const adapter = byChannel.get(channel);

      if (!adapter) {
        throw new Error(`No adapter registered for ${channel}`);
      }

      return adapter;
    },
    all() {
      return adapters;
    },
  };
};

export const createMockStatusResolver = (): ProviderStatusResolver => ({
  async resolve(provider, providerMessageId) {
    if (provider.startsWith("mock_") && providerMessageId.startsWith(`${provider}_`)) {
      return { state: "delivered" };
    }

    return { state: "unknown" };
  },
});

export { MockAdapter } from "./mock";
export { SmtpEmailAdapter, createSmtpAdapter } from "./email";
