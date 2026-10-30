import type { Request, Response } from "express";

import { sendSuccess } from "../../core/http/response";
import * as service from "./campaign.service";

const params = (req: Request) => req.validated?.params as { id: string };

export const listCampaignsController = async (_req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.list());
};

export const getCampaignController = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.detail(params(req).id));
};

export const createCampaignController = async (req: Request, res: Response): Promise<void> => {
  const body = req.validated?.body as Parameters<typeof service.create>[0];
  sendSuccess(res, await service.create(body, req.apiClient!.name), 201);
};

export const launchCampaignController = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.launch(params(req).id));
};

export const pauseCampaignController = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.pause(params(req).id));
};

export const resumeCampaignController = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.resume(params(req).id));
};

export const cancelCampaignController = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.cancel(params(req).id));
};

export const campaignStatsController = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.stats(params(req).id));
};

export const campaignRecipientsController = async (req: Request, res: Response): Promise<void> => {
  const query = req.validated?.query as { limit: number; status?: string; cursor?: string };
  const page = await service.recipients(params(req).id, {
    limit: query.limit,
    status: query.status as never,
    cursor: query.cursor,
  });

  sendSuccess(res, page.items, 200, page.meta);
};
