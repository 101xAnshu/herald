import type { FaultInjection, Source } from "@herald/contracts";
import type { Request, Response } from "express";

import { sendSuccess } from "../../core/http/response";
import * as service from "./ops.service";

const params = (req: Request) => req.validated?.params as Record<string, string>;
const query = (req: Request) => req.validated?.query as Record<string, unknown>;
const actor = (req: Request) => req.apiClient?.name ?? "operator";

export const statsController = async (_req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.stats());
};

export const outboxController = async (req: Request, res: Response): Promise<void> => {
  const q = query(req) as { limit: number; status?: string };
  sendSuccess(res, await service.outbox(q));
};

export const retriesController = async (req: Request, res: Response): Promise<void> => {
  const q = query(req) as { limit: number; due_only?: string };
  sendSuccess(res, await service.retries({ limit: q.limit, dueOnly: q.due_only === "true" }));
};

export const promoteRetryController = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.promoteRetry(params(req)["delivery_id"] as string));
};

export const dlqController = async (req: Request, res: Response): Promise<void> => {
  const q = query(req) as { limit: number; include_discarded?: string };
  sendSuccess(res, await service.dlq({ limit: q.limit, includeDiscarded: q.include_discarded === "true" }));
};

export const dlqDetailController = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.dlqDetail(params(req)["id"] as string));
};

export const replayController = async (req: Request, res: Response): Promise<void> => {
  const body = req.validated?.body as { dry_run: boolean };
  sendSuccess(res, await service.replay(params(req)["id"] as string, body.dry_run, actor(req)));
};

export const discardController = async (req: Request, res: Response): Promise<void> => {
  const body = req.validated?.body as { reason: string };
  await service.discard(params(req)["id"] as string, body.reason, actor(req));
  res.status(204).send();
};

export const pauseSourceController = async (req: Request, res: Response): Promise<void> => {
  const body = req.validated?.body as { reason: string };
  const control = await service.pauseSource(params(req)["name"] as Source, body.reason, actor(req));
  sendSuccess(res, { source: control.source.toLowerCase(), paused: control.paused, reason: control.reason });
};

export const resumeSourceController = async (req: Request, res: Response): Promise<void> => {
  const body = req.validated?.body as { reason: string };
  const control = await service.resumeSource(params(req)["name"] as Source, body.reason, actor(req));
  sendSuccess(res, { source: control.source.toLowerCase(), paused: control.paused, reason: control.reason });
};

export const sourcesController = async (_req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.sources());
};

export const providersController = async (_req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.providers());
};

export const faultController = async (req: Request, res: Response): Promise<void> => {
  const body = req.validated?.body as FaultInjection;
  const fault = await service.injectFault(body, actor(req));
  sendSuccess(res, {
    provider: fault.provider,
    channel: fault.channel.toLowerCase(),
    outcome: fault.outcome,
    expires_at: fault.expiresAt.toISOString(),
  });
};

export const auditController = async (req: Request, res: Response): Promise<void> => {
  const q = query(req) as { limit: number };
  sendSuccess(res, await service.audit(q.limit));
};

export const failoverController = async (_req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.failoverState());
};

export const failoverDryRunController = async (_req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.failoverDryRun());
};
