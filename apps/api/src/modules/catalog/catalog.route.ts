import { Router } from "express";

import { authenticate, requireScope } from "../../core/middleware/auth.middleware";
import { validate } from "../../core/middleware/validate.middleware";
import {
  createEventTypeController,
  getEventTypeController,
  listEventTypesController,
  updateEventTypeController,
} from "./catalog.controller";
import {
  CatalogKeyParamsSchema,
  CreateEventTypeBodySchema,
  UpdateEventTypeBodySchema,
} from "./catalog.types";

const router: Router = Router();

router.use(authenticate);
router.use(requireScope("events:read"));

router.get("/event-types", listEventTypesController);
router.get("/event-types/:key", validate({ params: CatalogKeyParamsSchema }), getEventTypeController);

export default router;

export const adminRouter: Router = Router();

adminRouter.use(authenticate);
adminRouter.use(requireScope("catalog:write"));
adminRouter.post("/event-types", validate({ body: CreateEventTypeBodySchema }), createEventTypeController);
adminRouter.patch(
  "/event-types/:key",
  validate({ params: CatalogKeyParamsSchema, body: UpdateEventTypeBodySchema }),
  updateEventTypeController,
);
