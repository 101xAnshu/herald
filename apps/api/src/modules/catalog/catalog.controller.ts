import type { Request, Response } from "express";

import { sendSuccess } from "../../core/http/response";
import * as service from "./catalog.service";

export const listEventTypesController = async (_req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.listCatalogEventTypes());
};

export const getEventTypeController = async (req: Request, res: Response): Promise<void> => {
  const params = req.validated?.params as { key: string };
  sendSuccess(res, await service.getCatalogEventType(params.key));
};

export const createEventTypeController = async (req: Request, res: Response): Promise<void> => {
  const body = req.validated?.body as Parameters<typeof service.addEventType>[0];
  sendSuccess(res, await service.addEventType(body), 201);
};

export const updateEventTypeController = async (req: Request, res: Response): Promise<void> => {
  const params = req.validated?.params as { key: string };
  const body = req.validated?.body as Parameters<typeof service.patchEventType>[1];
  sendSuccess(res, await service.patchEventType(params.key, body));
};
