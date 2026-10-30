import { Router } from "express";

import { authenticate, requireScope } from "../../core/middleware/auth.middleware";
import { validate } from "../../core/middleware/validate.middleware";
import {
  auditController,
  discardController,
  dlqController,
  dlqDetailController,
  failoverController,
  failoverDryRunController,
  faultController,
  outboxController,
  pauseSourceController,
  promoteRetryController,
  providersController,
  replayController,
  resumeSourceController,
  retriesController,
  sourcesController,
  statsController,
} from "./ops.controller";
import {
  AuditQuerySchema,
  DeliveryIdParamsSchema,
  DiscardBodySchema,
  DlqIdParamsSchema,
  DlqQuerySchema,
  FaultBodySchema,
  OutboxQuerySchema,
  PauseBodySchema,
  ProviderParamsSchema,
  ReplayBodySchema,
  RetriesQuerySchema,
  SourceParamsSchema,
} from "./ops.types";

const router: Router = Router();

router.use(authenticate);

router.get("/stats", requireScope("ops:read"), statsController);
router.get("/outbox", requireScope("ops:read"), validate({ query: OutboxQuerySchema }), outboxController);
router.get("/retries", requireScope("ops:read"), validate({ query: RetriesQuerySchema }), retriesController);
router.post(
  "/retries/:delivery_id/promote",
  requireScope("ops:manage"),
  validate({ params: DeliveryIdParamsSchema }),
  promoteRetryController,
);

router.get("/dlq", requireScope("ops:read"), validate({ query: DlqQuerySchema }), dlqController);
router.get("/dlq/:id", requireScope("ops:read"), validate({ params: DlqIdParamsSchema }), dlqDetailController);
router.post(
  "/dlq/:id/replay",
  requireScope("ops:manage"),
  validate({ params: DlqIdParamsSchema, body: ReplayBodySchema }),
  replayController,
);
router.delete(
  "/dlq/:id",
  requireScope("ops:manage"),
  validate({ params: DlqIdParamsSchema, body: DiscardBodySchema }),
  discardController,
);

router.get("/sources", requireScope("ops:read"), sourcesController);
router.post(
  "/sources/:name/pause",
  requireScope("ops:manage"),
  validate({ params: SourceParamsSchema, body: PauseBodySchema }),
  pauseSourceController,
);
router.post(
  "/sources/:name/resume",
  requireScope("ops:manage"),
  validate({ params: SourceParamsSchema, body: PauseBodySchema }),
  resumeSourceController,
);

router.get("/providers", requireScope("ops:read"), providersController);
router.post(
  "/providers/:name/fault",
  requireScope("ops:manage"),
  validate({ params: ProviderParamsSchema, body: FaultBodySchema }),
  faultController,
);

router.get("/audit", requireScope("ops:read"), validate({ query: AuditQuerySchema }), auditController);
router.get("/failover", requireScope("ops:read"), failoverController);
router.post("/failover/dry-run", requireScope("ops:manage"), failoverDryRunController);

export default router;
