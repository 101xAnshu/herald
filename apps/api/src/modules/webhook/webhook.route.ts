import express, { Router } from "express";

import { webhookController } from "./webhook.controller";

export const webhookRouter: Router = Router();

webhookRouter.post(
  "/:provider",
  express.raw({ type: "application/json", limit: "1mb" }),
  webhookController,
);
