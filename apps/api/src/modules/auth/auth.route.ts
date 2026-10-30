import { Router } from "express";

import { authenticate, requireScope } from "../../core/middleware/auth.middleware";
import { validate } from "../../core/middleware/validate.middleware";
import {
  createKeyController,
  demoTokenController,
  listKeysController,
  revokeKeyController,
  rotateKeyController,
  whoamiController,
} from "./auth.controller";
import {
  ApiKeyBodySchema,
  ApiKeyIdParamsSchema,
  ApiKeyRotateBodySchema,
  DemoTokenBodySchema,
} from "./auth.types";

export const demoRouter: Router = Router();

demoRouter.post("/token", validate({ body: DemoTokenBodySchema }), demoTokenController);

export const keysRouter: Router = Router();

keysRouter.use(authenticate);
keysRouter.use(requireScope("keys:manage"));
keysRouter.get("/", listKeysController);
keysRouter.post("/", validate({ body: ApiKeyBodySchema }), createKeyController);
keysRouter.post(
  "/:id/rotate",
  validate({ params: ApiKeyIdParamsSchema, body: ApiKeyRotateBodySchema }),
  rotateKeyController,
);
keysRouter.delete("/:id", validate({ params: ApiKeyIdParamsSchema }), revokeKeyController);

export const whoamiRouter: Router = Router();

whoamiRouter.use(authenticate);
whoamiRouter.get("/", whoamiController);
