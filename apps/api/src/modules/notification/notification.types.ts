import { NotificationListQuerySchema } from "@herald/contracts";
import { z } from "zod";

export const NotificationParamsSchema = z.object({ id: z.uuid() });
export const NotificationQuerySchema = NotificationListQuerySchema;
