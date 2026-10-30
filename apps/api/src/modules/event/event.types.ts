import { IngestBatchSchema, IngestEventSchema } from "@herald/contracts";
import { z } from "zod";

export const EventBodySchema = IngestEventSchema;
export const BatchBodySchema = IngestBatchSchema;
export const EventParamsSchema = z.object({ id: z.uuid() });
