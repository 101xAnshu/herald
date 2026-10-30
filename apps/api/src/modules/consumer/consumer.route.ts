import { Router } from "express";

import { authenticate, requireUser } from "../../core/middleware/auth.middleware";
import { rateLimit } from "../../core/middleware/rate-limit.middleware";
import { validate } from "../../core/middleware/validate.middleware";
import {
  inboxDetailController,
  listInboxController,
  preferencesController,
  quietHoursController,
  readAllController,
  readOneController,
  streamController,
  unsubscribeController,
  updatePreferencesController,
} from "./consumer.controller";
import {
  InboxItemParamsSchema,
  InboxListQuerySchema,
  PreferencesBodySchema,
  QuietHoursBodySchema,
  UnsubscribeBodySchema,
} from "./consumer.types";

const router: Router = Router();

router.use(authenticate);
router.use(requireUser);
router.use(rateLimit("user", 120, 60));

router.get("/inbox/stream", streamController);
router.get("/inbox", validate({ query: InboxListQuerySchema }), listInboxController);
router.post("/inbox/read-all", readAllController);
router.get("/inbox/:id", validate({ params: InboxItemParamsSchema }), inboxDetailController);
router.post("/inbox/:id/read", validate({ params: InboxItemParamsSchema }), readOneController);

router.get("/preferences", preferencesController);
router.patch("/preferences", validate({ body: PreferencesBodySchema }), updatePreferencesController);
router.put("/quiet-hours", validate({ body: QuietHoursBodySchema }), quietHoursController);
router.post("/unsubscribe", validate({ body: UnsubscribeBodySchema }), unsubscribeController);

export default router;
