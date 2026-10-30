import { Router } from "express";

import { authenticate, requireScope } from "../../core/middleware/auth.middleware";
import { validate } from "../../core/middleware/validate.middleware";
import {
  cancelNotificationController,
  getDeliveriesController,
  getNotificationController,
  getTraceController,
  listNotificationsController,
  retryNotificationController,
} from "./notification.controller";
import { NotificationParamsSchema, NotificationQuerySchema } from "./notification.types";

const router: Router = Router();

router.use(authenticate);
router.use(requireScope("events:read"));

router.get("/", validate({ query: NotificationQuerySchema }), listNotificationsController);
router.get("/:id", validate({ params: NotificationParamsSchema }), getNotificationController);
router.get("/:id/trace", validate({ params: NotificationParamsSchema }), getTraceController);
router.get(
  "/:id/deliveries",
  validate({ params: NotificationParamsSchema }),
  getDeliveriesController,
);
router.post(
  "/:id/cancel",
  requireScope("notifications:manage"),
  validate({ params: NotificationParamsSchema }),
  cancelNotificationController,
);
router.post(
  "/:id/retry",
  requireScope("notifications:manage"),
  validate({ params: NotificationParamsSchema }),
  retryNotificationController,
);

export default router;
