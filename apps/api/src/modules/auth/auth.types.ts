import { ApiKeyCreateSchema, ApiKeyRotateSchema, DemoTokenSchema } from "@herald/contracts";
import { z } from "zod";

export const DemoTokenBodySchema = DemoTokenSchema;
export const ApiKeyBodySchema = ApiKeyCreateSchema;
export const ApiKeyRotateBodySchema = ApiKeyRotateSchema;
export const ApiKeyIdParamsSchema = z.object({ id: z.uuid() });
