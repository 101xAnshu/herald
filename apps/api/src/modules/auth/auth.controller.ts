import type { Request, Response } from "express";

import { sendSuccess } from "../../core/http/response";
import * as service from "./auth.service";

const params = (req: Request) => req.validated?.params as { id: string };

export const demoTokenController = async (req: Request, res: Response): Promise<void> => {
  const body = req.validated?.body as { external_id: string };
  sendSuccess(res, await service.mintDemoToken(body.external_id));
};

export const createKeyController = async (req: Request, res: Response): Promise<void> => {
  const body = req.validated?.body as Parameters<typeof service.createKey>[0];
  const result = await service.createKey(body, req.apiClient!.name);
  sendSuccess(res, result, 201);
};

export const rotateKeyController = async (req: Request, res: Response): Promise<void> => {
  const body = req.validated?.body as Parameters<typeof service.rotateKey>[1];
  sendSuccess(res, await service.rotateKey(params(req).id, body, req.apiClient!.name));
};

export const revokeKeyController = async (req: Request, res: Response): Promise<void> => {
  await service.revokeKey(params(req).id, req.apiClient!.name);
  res.status(204).send();
};

export const listKeysController = async (_req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.listKeys());
};

export const whoamiController = (req: Request, res: Response): void => {
  if (req.apiClient) {
    sendSuccess(res, {
      kind: "service",
      id: req.apiClient.id,
      name: req.apiClient.name,
      source: req.apiClient.source,
      scopes: req.apiClient.scopes,
    });
    return;
  }

  sendSuccess(res, { kind: "user", user_id: req.userId });
};
