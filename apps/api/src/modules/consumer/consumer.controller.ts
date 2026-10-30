import type { InboxItemView, PreferencesResponse, Unsubscribe } from "@herald/contracts";
import { getPrismaForUser } from "@herald/db";
import { logger } from "@herald/observability";
import type { Request, Response } from "express";

import { sendSuccess } from "../../core/http/response";
import { redis } from "../../core/middleware/rate-limit.middleware";
import * as service from "./consumer.service";

const params = (req: Request) => req.validated?.params as { id: string };

export const listInboxController = async (req: Request, res: Response): Promise<void> => {
  const query = req.validated?.query as { limit: number; cursor?: string; unread?: boolean };
  const page = await service.inboxPage(req.userId!, query);
  sendSuccess(res, page.items, 200, page.meta);
};

export const inboxDetailController = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.inboxDetail(req.userId!, params(req).id));
};

export const readOneController = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.readOne(req.userId!, params(req).id));
};

export const readAllController = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.readAll(req.userId!));
};

export const preferencesController = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.preferences(req.userId!));
};

export const updatePreferencesController = async (req: Request, res: Response): Promise<void> => {
  const body = req.validated?.body as PreferencesResponse["preferences"];
  sendSuccess(res, await service.updatePreferenceSet(req.userId!, body));
};

export const quietHoursController = async (req: Request, res: Response): Promise<void> => {
  const body = req.validated?.body as { start: string; end: string; timezone: string };
  sendSuccess(res, await service.quietHours(req.userId!, body));
};

export const unsubscribeController = async (req: Request, res: Response): Promise<void> => {
  const body = req.validated?.body as Unsubscribe;
  sendSuccess(res, await service.unsubscribe(req.userId!, body));
};

const writeEvent = (res: Response, payload: InboxItemView & { sequence?: string }): void => {
  res.write(`id: ${payload.sequence ?? payload.id}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

export const streamController = async (req: Request, res: Response): Promise<void> => {
  const userId = req.userId!;
  const db = getPrismaForUser(userId);
  const channel = `inbox:events:${userId}`;

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write("retry: 3000\n\n");

  const lastEventId = req.header("last-event-id");

  if (lastEventId && /^\d+$/.test(lastEventId)) {
    const missed = await db.inboxItem.findMany({
      where: { userId, sequence: { gt: BigInt(lastEventId) } },
      orderBy: { sequence: "asc" },
      take: 100,
    });

    for (const item of missed) {
      writeEvent(res, service.inboxView(item));
    }
  }

  const unsubscribe = await redis().subscribe(channel, (payload) => {
    writeEvent(res, payload as InboxItemView & { sequence?: string });
  });

  const heartbeat = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    void unsubscribe().catch((error: unknown) => {
      logger.warn({ err: error, trace_id: req.traceId }, "failed to close SSE subscription");
    });
    res.end();
  });
};
