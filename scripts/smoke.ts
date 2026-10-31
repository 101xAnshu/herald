import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readDemo = (): Record<string, string> => {
  const path = resolve(process.cwd(), ".herald/demo.env");
  const values: Record<string, string> = {};

  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const separator = line.indexOf("=");

      if (separator > 0) {
        values[line.slice(0, separator)] = line.slice(separator + 1);
      }
    }
  } catch {
    return values;
  }

  return values;
};

const sleep = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const main = async (): Promise<void> => {
  const env = readDemo();
  const baseUrl = process.env["HERALD_API_URL"] ?? env["HERALD_API_URL"] ?? "http://localhost:3000";
  const opsKey = process.env["HERALD_OPS_API_KEY"] ?? env["HERALD_OPS_API_KEY"];
  const bookingKey = process.env["HERALD_BOOKING_API_KEY"] ?? env["HERALD_BOOKING_API_KEY"];

  if (!opsKey || !bookingKey) {
    throw new Error("demo credentials are missing; run pnpm db:seed");
  }

  const ready = await fetch(`${baseUrl}/health/ready`);

  if (!ready.ok) {
    throw new Error(`API is not ready: ${ready.status}`);
  }

  const externalId = "cust_00001";
  const idempotencyKey = `smoke:${Date.now()}`;
  const event = {
    type: "booking.confirmed",
    schema_version: 1,
    recipient: { external_id: externalId },
    idempotency_key: idempotencyKey,
    data: {
      booking_id: "bkg_smoke",
      service: "plumbing",
      pro_name: "Ravi",
      scheduled_for: "2026-11-02T10:00:00+05:30",
      address_label: "Home",
    },
  };

  const send = async () => {
    const response = await fetch(`${baseUrl}/v1/events`, {
      method: "POST",
      headers: { authorization: `Bearer ${bookingKey}`, "content-type": "application/json" },
      body: JSON.stringify(event),
    });

    if (!response.ok) {
      throw new Error(`ingest failed: ${response.status} ${await response.text()}`);
    }

    return (await response.json()) as { data: { notification_id: string; trace_id: string } };
  };

  const accepted = await send();
  const duplicate = await send();

  if (accepted.data.notification_id !== duplicate.data.notification_id) {
    throw new Error("idempotency returned two notification IDs");
  }

  const missing = await fetch(`${baseUrl}/v1/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${bookingKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      ...event,
      recipient: { external_id: "missing_recipient" },
      idempotency_key: `${idempotencyKey}:missing`,
    }),
  });

  if (missing.status !== 422) {
    throw new Error(`unknown recipient returned ${missing.status}, expected 422`);
  }

  let trace: {
    data: {
      notification: { status: string };
      deliveries: Array<{ channel: string; status: string }>;
    };
  } | null = null;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${baseUrl}/v1/notifications/${accepted.data.notification_id}/trace`, {
      headers: { authorization: `Bearer ${opsKey}` },
    });

    if (response.ok) {
      trace = (await response.json()) as typeof trace;

      if (["delivered", "partially_delivered", "failed", "suppressed"].includes(trace.data.notification.status)) {
        break;
      }
    }

    await sleep(1000);
  }

  if (!trace || !["delivered", "partially_delivered", "failed", "suppressed"].includes(trace.data.notification.status)) {
    throw new Error("notification did not reach a terminal state within 30s");
  }

  if (trace.data.deliveries.length === 0) {
    throw new Error("notification produced no deliveries");
  }

  const tokenResponse = await fetch(`${baseUrl}/v1/demo/token`, {
    method: "POST",
    headers: { authorization: `Bearer ${opsKey}`, "content-type": "application/json" },
    body: JSON.stringify({ external_id: externalId }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`demo token failed: ${tokenResponse.status}`);
  }

  const token = (await tokenResponse.json()) as { data: { access_token: string } };
  const inbox = await fetch(`${baseUrl}/v1/me/inbox`, {
    headers: { authorization: `Bearer ${token.data.access_token}` },
  });

  if (!inbox.ok) {
    throw new Error(`inbox failed: ${inbox.status}`);
  }

  const inboxBody = (await inbox.json()) as { data: Array<{ id: string }> };

  if (inboxBody.data.length === 0) {
    throw new Error("inbox item missing");
  }

  process.stdout.write(
    `smoke ok notification=${accepted.data.notification_id} status=${trace.data.notification.status} deliveries=${trace.data.deliveries.length} inbox=${inboxBody.data.length}\n`,
  );
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
