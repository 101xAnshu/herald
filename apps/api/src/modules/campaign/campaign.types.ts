import { CampaignCreateSchema, CampaignRecipientsQuerySchema } from "@herald/contracts";
import { z } from "zod";

export const CampaignIdParamsSchema = z.object({ id: z.uuid() });
export const CampaignCreateBodySchema = CampaignCreateSchema;
export const RecipientsQuerySchema = CampaignRecipientsQuerySchema;
