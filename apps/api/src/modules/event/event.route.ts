import { Router } from "express";

import { authenticate, requireScope } from "../../core/middleware/auth.middleware";
import { rateLimitMany } from "../../core/middleware/rate-limit.middleware";
import { validate } from "../../core/middleware/validate.middleware";
import { createBatchController, createEventController } from "./event.controller";
import { BatchBodySchema, EventBodySchema } from "./event.types";

const router: Router = Router();

router.use(authenticate);
router.use(requireScope("events:write"));
router.use(
  rateLimitMany([
    { scope: "api_key", limit: 60_000, windowSeconds: 60 },
    { scope: "source", limit: 120_000, windowSeconds: 60 },
    { scope: "ip", limit: 60_000, windowSeconds: 60 },
  ]),
);

router.post("/", validate({ body: EventBodySchema }), createEventController);
router.post("/batch", validate({ body: BatchBodySchema }), createBatchController);

export default router;
