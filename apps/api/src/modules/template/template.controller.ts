import type { Request, Response } from "express";

import { AppError } from "@herald/core";

import { sendSuccess } from "../../core/http/response";
import * as service from "./template.service";

const params = (req: Request) => req.validated?.params as { id: string };

export const listTemplatesController = async (_req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.listCatalogTemplates());
};

export const getTemplateController = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.getCatalogTemplate(params(req).id));
};

export const createTemplateController = async (req: Request, res: Response): Promise<void> => {
  const body = req.validated?.body as Parameters<typeof service.addTemplate>[0];
  sendSuccess(res, await service.addTemplate(body), 201);
};

export const createVersionController = async (req: Request, res: Response): Promise<void> => {
  const body = req.validated?.body as Parameters<typeof service.addTemplateVersion>[1];
  sendSuccess(res, await service.addTemplateVersion(params(req).id, body, req.apiClient!.name), 201);
};

export const publishController = async (req: Request, res: Response): Promise<void> => {
  const body = req.validated?.body as { version_id: string };
  sendSuccess(res, await service.publishVersion(params(req).id, body.version_id));
};

export const previewController = async (req: Request, res: Response): Promise<void> => {
  const query = req.validated?.query as { version_id?: string; data?: string };
  let data: Record<string, unknown> = {};

  if (query.data) {
    try {
      data = JSON.parse(query.data) as Record<string, unknown>;
    } catch {
      throw new AppError("validation_failed", "Preview data must be valid JSON", 422);
    }
  }

  sendSuccess(
    res,
    await service.previewTemplate(params(req).id, { version_id: query.version_id, data }),
  );
};

export const testTemplateController = async (req: Request, res: Response): Promise<void> => {
  const body = req.validated?.body as { external_id: string; data: Record<string, unknown> };
  sendSuccess(res, await service.sendTemplateTest(params(req).id, body, req.traceId), 202);
};
