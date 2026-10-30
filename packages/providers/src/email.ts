import { createTransport, type Transporter } from "nodemailer";

import type { ChannelAdapter, OutboundMessage, ProviderSendResult } from "@herald/core";
import { classifyProviderError } from "@herald/core";
import { loadConfig } from "@herald/config";

export class SmtpEmailAdapter implements ChannelAdapter {
  readonly name = "smtp";
  readonly channel = "email" as const;
  private readonly transport: Transporter;

  constructor(url: string) {
    const parsed = new URL(url);
    const secure = parsed.protocol === "smtps:";

    this.transport = createTransport({
      host: parsed.hostname,
      port: Number(parsed.port || (secure ? 465 : 25)),
      secure,
      ...(parsed.username
        ? { auth: { user: decodeURIComponent(parsed.username), pass: decodeURIComponent(parsed.password) } }
        : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }

  idempotencyKey(deliveryId: string): string {
    return `herald:${deliveryId}`;
  }

  classify(failure: { status?: number; code?: string; bodyWritten?: boolean }) {
    return classifyProviderError(failure);
  }

  async send(message: OutboundMessage): Promise<ProviderSendResult> {
    if (!message.recipient.email) {
      return {
        ok: false,
        error: { class: "invalid_recipient", code: "missing_email", message: "No email address" },
      };
    }

    try {
      const info = await this.transport.sendMail({
        from: "Herald <notifications@herald.local>",
        to: message.recipient.email,
        subject: message.subject ?? "Notification",
        text: message.text,
        html: message.html ?? undefined,
        headers: {
          "X-Herald-Idempotency-Key": message.idempotencyKey,
          "X-Herald-Delivery-Id": message.deliveryId,
          "X-Herald-Trace-Id": message.traceId,
        },
      });

      return {
        ok: true,
        providerMessageId: info.messageId,
        response: { accepted: info.accepted, rejected: info.rejected },
      };
    } catch (error) {
      const responseCode =
        typeof error === "object" && error !== null && "responseCode" in error
          ? Number((error as { responseCode: unknown }).responseCode)
          : undefined;
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "smtp_error";

      return {
        ok: false,
        error: {
          class: classifyProviderError({ status: responseCode, code, bodyWritten: true }),
          code,
          message: error instanceof Error ? error.message : "SMTP send failed",
        },
      };
    }
  }
}

export const createSmtpAdapter = (): SmtpEmailAdapter =>
  new SmtpEmailAdapter(loadConfig().smtpUrl);
