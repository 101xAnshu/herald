import { CreateEventTypeSchema, UpdateEventTypeSchema } from "@herald/contracts";
import { z } from "zod";

export const CatalogKeyParamsSchema = z.object({ key: z.string().min(1) });
export const CreateEventTypeBodySchema = CreateEventTypeSchema;
export const UpdateEventTypeBodySchema = UpdateEventTypeSchema;
