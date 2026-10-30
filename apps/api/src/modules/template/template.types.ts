import type { CreateTemplate, CreateTemplateVersion, TemplatePreview } from "@herald/contracts";
import { CreateTemplateSchema, CreateTemplateVersionSchema } from "@herald/contracts";
import { z } from "zod";

export const TemplateIdParamsSchema = z.object({ id: z.uuid() });
export const CreateTemplateBodySchema = CreateTemplateSchema;
export const CreateVersionBodySchema = CreateTemplateVersionSchema;
export const PreviewQuerySchema = z.object({
  version_id: z.uuid().optional(),
  data: z.string().optional(),
});
export const PublishBodySchema = z.object({ version_id: z.uuid() });
export const TestTemplateBodySchema = z.object({
  external_id: z.string().min(1).max(200),
  data: z.record(z.string(), z.unknown()).default({}),
});

export type CreateTemplateInput = CreateTemplate;
export type CreateTemplateVersionInput = CreateTemplateVersion;
export type TemplatePreviewInput = TemplatePreview;
