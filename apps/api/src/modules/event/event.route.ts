import { Router } from "express";

import { authenticate, requireScope } from "../../core/middleware/auth.middleware";
import { rateLimit } from "../../core/middleware/rate-limit.middleware";
import { validate } from "../../core/middleware/validate.middleware";
import { createBatchController, createEventController } from "./event.controller";
import { BatchBodySchema, EventBodySchema } from "./event.types";

const router: Router = Router();

router.use(authenticate);
router.use(requireScope("events:write"));
router.use(rateLimit("api_key", 60_000, 60));
router.use(rateLimit("source", 120_000, 60));
router.use(rateLimit("ip", 60_000, 60));

router.post("/", validate({ body: EventBodySchema }), createEventController);
router.post("/batch", validate({ body: BatchBodySchema }), createBatchController);

export default router;
