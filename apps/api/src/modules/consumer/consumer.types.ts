import { InboxQuerySchema, QuietHoursSchema, UnsubscribeSchema, UpdatePreferencesSchema } from "@herald/contracts";
import { z } from "zod";

export const InboxItemParamsSchema = z.object({ id: z.uuid() });
export const InboxListQuerySchema = InboxQuerySchema;
export const PreferencesBodySchema = UpdatePreferencesSchema;
export const QuietHoursBodySchema = QuietHoursSchema;
export const UnsubscribeBodySchema = UnsubscribeSchema;
export const IdParamsSchema = z.object({ id: z.uuid() });
