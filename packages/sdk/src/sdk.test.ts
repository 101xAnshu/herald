import { describe, expect, it } from "vitest";

import { HeraldApiError, HeraldClient } from "./index";

const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-trace-id": "trace-1" },
  });

describe("sdk", () => {
  it("sends a service key and returns the envelope", async () => {
    let authorization = "";
    const client = new HeraldClient({
      baseUrl: "http://herald.test",
      apiKey: "hrld_test",
      fetchImpl: async (_url, init) => {
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return response(202, {
          data: { notification_id: "n1", status: "accepted", trace_id: "trace-1" },
          trace_id: "trace-1",
        });
      },
    });

    const result = await client.sendEvent({
      type: "booking.confirmed",
      schema_version: 1,
      recipient: { external_id: "cust_1" },
      idempotency_key: "idem-1",
      data: {},
    });

    expect(authorization).toBe("Bearer hrld_test");
    expect(result.data.notification_id).toBe("n1");
  });

  it("raises a typed API error", async () => {
    const client = new HeraldClient({
      baseUrl: "http://herald.test",
      apiKey: "hrld_test",
      retries: 0,
      fetchImpl: async () =>
        response(409, {
          error: { code: "idempotency_conflict", message: "conflict" },
          trace_id: "trace-2",
        }),
    });

    await expect(
      client.sendEvent({
        type: "booking.confirmed",
        schema_version: 1,
        recipient: { external_id: "cust_1" },
        idempotency_key: "idem-2",
        data: {},
      }),
    ).rejects.toBeInstanceOf(HeraldApiError);
  });

  it("retries transport failures", async () => {
    let calls = 0;
    const client = new HeraldClient({
      baseUrl: "http://herald.test",
      apiKey: "hrld_test",
      retries: 1,
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error("reset"))
          : response(200, { data: [], trace_id: "trace-3" });
      },
    });

    const result = await client.listNotifications();
    expect(result.data).toEqual([]);
    expect(calls).toBe(2);
  });
});
