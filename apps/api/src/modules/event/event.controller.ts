import type { Request, Response } from "express";

import { sendSuccess } from "../../core/http/response";
import { acceptBatch, acceptEvent } from "./event.service";

export const createEventController = async (req: Request, res: Response): Promise<void> => {
  const body = req.validated?.body as Parameters<typeof acceptEvent>[0]["event"];
  const result = await acceptEvent({
    source: req.apiClient!.source,
    event: body,
    traceId: req.traceId,
    actor: `key:${req.apiClient!.id}`,
  });

  sendSuccess(
    res,
    {
      notification_id: result.notificationId,
      status: "accepted",
      trace_id: result.traceId,
      duplicate: result.duplicate,
    },
    202,
  );
};

export const createBatchController = async (req: Request, res: Response): Promise<void> => {
  const body = req.validated?.body as { events: unknown[] };
  const result = await acceptBatch({
    source: req.apiClient!.source,
    events: body.events,
    traceId: req.traceId,
    actor: `key:${req.apiClient!.id}`,
  });

  sendSuccess(res, result, 202);
};
