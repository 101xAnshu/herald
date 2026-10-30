import { Router } from "express";

import { authenticate, requireScope } from "../../core/middleware/auth.middleware";
import { validate } from "../../core/middleware/validate.middleware";
import {
  createTemplateController,
  createVersionController,
  getTemplateController,
  listTemplatesController,
  previewController,
  publishController,
  testTemplateController,
} from "./template.controller";
import {
  CreateTemplateBodySchema,
  CreateVersionBodySchema,
  PreviewQuerySchema,
  PublishBodySchema,
  TemplateIdParamsSchema,
  TestTemplateBodySchema,
} from "./template.types";

export const readRouter: Router = Router();

readRouter.use(authenticate);
readRouter.use(requireScope("events:read"));
readRouter.get("/templates", listTemplatesController);
readRouter.get("/templates/:id", validate({ params: TemplateIdParamsSchema }), getTemplateController);

export const adminRouter: Router = Router();

adminRouter.use(authenticate);
adminRouter.use(requireScope("catalog:write"));
adminRouter.post("/templates", validate({ body: CreateTemplateBodySchema }), createTemplateController);
adminRouter.post(
  "/templates/:id/versions",
  validate({ params: TemplateIdParamsSchema, body: CreateVersionBodySchema }),
  createVersionController,
);
adminRouter.post(
  "/templates/:id/publish",
  validate({ params: TemplateIdParamsSchema, body: PublishBodySchema }),
  publishController,
);
adminRouter.get(
  "/templates/:id/preview",
  validate({ params: TemplateIdParamsSchema, query: PreviewQuerySchema }),
  previewController,
);
adminRouter.post(
  "/templates/:id/test",
  validate({ params: TemplateIdParamsSchema, body: TestTemplateBodySchema }),
  testTemplateController,
);
