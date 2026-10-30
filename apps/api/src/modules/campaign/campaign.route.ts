import { Router } from "express";

import { authenticate, requireScope } from "../../core/middleware/auth.middleware";
import { validate } from "../../core/middleware/validate.middleware";
import {
  campaignRecipientsController,
  campaignStatsController,
  cancelCampaignController,
  createCampaignController,
  getCampaignController,
  launchCampaignController,
  listCampaignsController,
  pauseCampaignController,
  resumeCampaignController,
} from "./campaign.controller";
import {
  CampaignCreateBodySchema,
  CampaignIdParamsSchema,
  RecipientsQuerySchema,
} from "./campaign.types";

const router: Router = Router();

router.use(authenticate);

router.get("/", requireScope("campaigns:read"), listCampaignsController);
router.get("/:id", requireScope("campaigns:read"), validate({ params: CampaignIdParamsSchema }), getCampaignController);
router.get(
  "/:id/stats",
  requireScope("campaigns:read"),
  validate({ params: CampaignIdParamsSchema }),
  campaignStatsController,
);
router.get(
  "/:id/recipients",
  requireScope("campaigns:read"),
  validate({ params: CampaignIdParamsSchema, query: RecipientsQuerySchema }),
  campaignRecipientsController,
);

router.post(
  "/",
  requireScope("campaigns:write"),
  validate({ body: CampaignCreateBodySchema }),
  createCampaignController,
);
router.post(
  "/:id/launch",
  requireScope("campaigns:write"),
  validate({ params: CampaignIdParamsSchema }),
  launchCampaignController,
);
router.post(
  "/:id/pause",
  requireScope("campaigns:write"),
  validate({ params: CampaignIdParamsSchema }),
  pauseCampaignController,
);
router.post(
  "/:id/resume",
  requireScope("campaigns:write"),
  validate({ params: CampaignIdParamsSchema }),
  resumeCampaignController,
);
router.post(
  "/:id/cancel",
  requireScope("campaigns:write"),
  validate({ params: CampaignIdParamsSchema }),
  cancelCampaignController,
);

export default router;
