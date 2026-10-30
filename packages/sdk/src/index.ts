import type {
  AcceptedEvent,
  ApiKeyCreate,
  BatchAccepted,
  CampaignCreate,
  CampaignStats,
  CampaignView,
  DemoTokenResponse,
  DeliveryView,
  IngestEvent,
  InboxItemView,
  NotificationTrace,
  NotificationView,
  PaginationMeta,
  PreferencesResponse,
  QuietHours,
  UpdatePreferences,
} from "@herald/contracts";

export class HeraldApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly traceId: string;
  readonly details?: Record<string, unknown>;
  readonly issues?: unknown[];

  constructor(
    status: number,
    code: string,
    message: string,
    traceId: string,
    details?: Record<string, unknown>,
    issues?: unknown[],
  ) {
    super(message);
    this.name = "HeraldApiError";
    this.status = status;
    this.code = code;
    this.traceId = traceId;
    this.details = details;
    this.issues = issues;
  }
}

export interface HeraldClientOptions {
  baseUrl: string;
  apiKey?: string;
  userToken?: string;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

export interface Envelope<T> {
  data: T;
  meta?: PaginationMeta;
  trace_id: string;
}

export interface InboxPage {
  items: InboxItemView[];
  meta: PaginationMeta;
  traceId: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class HeraldClient {
  private readonly baseUrl: string;
  private apiKey: string | undefined;
  private userToken: string | undefined;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HeraldClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.userToken = options.userToken;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.retries = options.retries ?? 2;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  setUserToken(token: string): void {
    this.userToken = token;
  }

  private headers(idempotent = false): Record<string, string> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };

    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    } else if (this.userToken) {
      headers.authorization = `Bearer ${this.userToken}`;
    }

    if (idempotent) {
      headers["idempotency-key"] = crypto.randomUUID();
    }

    return headers;
  }

  async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {},
  ): Promise<Envelope<T>> {
    const url = new URL(`${this.baseUrl}${path}`);

    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          method,
          headers: this.headers(method === "POST" && path.includes("/events")),
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        const text = await response.text();
        const parsed = text ? (JSON.parse(text) as unknown) : {};

        if (!response.ok) {
          const envelope = parsed as {
            error?: { code?: string; message?: string; details?: Record<string, unknown>; errors?: unknown[] };
            trace_id?: string;
          };

          throw new HeraldApiError(
            response.status,
            envelope.error?.code ?? "http_error",
            envelope.error?.message ?? `HTTP ${response.status}`,
            envelope.trace_id ?? response.headers.get("x-trace-id") ?? "",
            envelope.error?.details,
            envelope.error?.errors,
          );
        }

        return parsed as Envelope<T>;
      } catch (error) {
        if (error instanceof HeraldApiError) {
          throw error;
        }

        lastError = error;

        if (attempt < this.retries) {
          await sleep(150 * 2 ** attempt);
        }
      }
    }

    throw new HeraldApiError(
      0,
      "network_error",
      lastError instanceof Error ? lastError.message : "Network request failed",
      "",
    );
  }

  sendEvent(event: IngestEvent): Promise<Envelope<AcceptedEvent & { duplicate?: boolean }>> {
    return this.request<AcceptedEvent & { duplicate?: boolean }>("POST", "/v1/events", {
      body: event,
    });
  }

  sendBatch(events: IngestEvent[]): Promise<Envelope<BatchAccepted>> {
    return this.request<BatchAccepted>("POST", "/v1/events/batch", { body: { events } });
  }

  listNotifications(query: Record<string, string | number | boolean | undefined> = {}): Promise<
    Envelope<NotificationView[]>
  > {
    return this.request<NotificationView[]>("GET", "/v1/notifications", { query });
  }

  getNotification(id: string): Promise<Envelope<{ notification: NotificationView; deliveries: DeliveryView[] }>> {
    return this.request("GET", `/v1/notifications/${id}`);
  }

  getTrace(id: string): Promise<Envelope<NotificationTrace>> {
    return this.request<NotificationTrace>("GET", `/v1/notifications/${id}/trace`);
  }

  cancelNotification(id: string): Promise<Envelope<{ notification: NotificationView; canceled_deliveries: number }>> {
    return this.request("POST", `/v1/notifications/${id}/cancel`, { body: {} });
  }

  retryNotification(id: string): Promise<Envelope<{ notification: NotificationView; retried_deliveries: number }>> {
    return this.request("POST", `/v1/notifications/${id}/retry`, { body: {} });
  }

  createCampaign(campaign: CampaignCreate): Promise<Envelope<CampaignView>> {
    return this.request<CampaignView>("POST", "/v1/campaigns", { body: campaign });
  }

  listCampaigns(): Promise<Envelope<CampaignView[]>> {
    return this.request<CampaignView[]>("GET", "/v1/campaigns");
  }

  getCampaign(id: string): Promise<Envelope<CampaignView>> {
    return this.request<CampaignView>("GET", `/v1/campaigns/${id}`);
  }

  campaignAction(
    id: string,
    action: "launch" | "pause" | "resume" | "cancel",
  ): Promise<Envelope<CampaignView>> {
    return this.request<CampaignView>("POST", `/v1/campaigns/${id}/${action}`, { body: {} });
  }

  getCampaignStats(id: string): Promise<Envelope<CampaignStats>> {
    return this.request<CampaignStats>("GET", `/v1/campaigns/${id}/stats`);
  }

  demoToken(externalId: string): Promise<Envelope<DemoTokenResponse>> {
    return this.request<DemoTokenResponse>("POST", "/v1/demo/token", {
      body: { external_id: externalId },
    });
  }

  async listInbox(query: { cursor?: string; limit?: number; unread?: boolean } = {}): Promise<InboxPage> {
    const envelope = await this.request<InboxItemView[]>("GET", "/v1/me/inbox", {
      query: {
        cursor: query.cursor,
        limit: query.limit,
        unread: query.unread === undefined ? undefined : query.unread,
      },
    });

    return {
      items: envelope.data,
      meta: envelope.meta ?? { next_cursor: null, has_more: false },
      traceId: envelope.trace_id,
    };
  }

  markInboxRead(id: string): Promise<Envelope<InboxItemView>> {
    return this.request<InboxItemView>("POST", `/v1/me/inbox/${id}/read`, { body: {} });
  }

  markAllInboxRead(): Promise<Envelope<{ updated: number }>> {
    return this.request("POST", "/v1/me/inbox/read-all", { body: {} });
  }

  getPreferences(): Promise<Envelope<PreferencesResponse>> {
    return this.request<PreferencesResponse>("GET", "/v1/me/preferences");
  }

  updatePreferences(input: UpdatePreferences): Promise<Envelope<PreferencesResponse>> {
    return this.request<PreferencesResponse>("PATCH", "/v1/me/preferences", { body: input });
  }

  setQuietHours(input: QuietHours): Promise<Envelope<PreferencesResponse>> {
    return this.request<PreferencesResponse>("PUT", "/v1/me/quiet-hours", { body: input });
  }

  unsubscribe(input: { category: string; channel: string; reason?: string }): Promise<Envelope<{ ok: boolean }>> {
    return this.request("POST", "/v1/me/unsubscribe", { body: input });
  }

  createApiKey(input: ApiKeyCreate): Promise<Envelope<{ id: string; key: string; prefix: string }>> {
    return this.request("POST", "/v1/admin/keys", { body: input });
  }

  async *streamInbox(signal?: AbortSignal): AsyncGenerator<InboxItemView> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/me/inbox/stream`, {
      headers: { ...this.headers(), accept: "text/event-stream" },
      signal,
    });

    if (!response.ok || !response.body) {
      throw new HeraldApiError(response.status, "stream_failed", "Could not open the inbox stream", "");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const event of events) {
        const dataLine = event
          .split("\n")
          .find((line) => line.startsWith("data: "));

        if (!dataLine) {
          continue;
        }

        try {
          yield JSON.parse(dataLine.slice(6)) as InboxItemView;
        } catch {
          continue;
        }
      }
    }
  }
}
