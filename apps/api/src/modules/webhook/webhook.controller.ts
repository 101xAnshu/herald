import type { Request, Response } from "express";

import { sendSuccess } from "../../core/http/response";
import { handleProviderWebhook } from "./webhook.service";

export const webhookController = async (req: Request, res: Response): Promise<void> => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? "");

  const result = await handleProviderWebhook({
    provider: String(req.params.provider),
    rawBody,
    timestamp: req.header("x-herald-timestamp") ?? "",
    signature: req.header("x-herald-signature") ?? "",
    traceId: req.traceId,
  });

  sendSuccess(res, result, 202);
};
