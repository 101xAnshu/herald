import {
  DlqDiscardSchema,
  DlqReplaySchema,
  FaultInjectionSchema,
  PaginationQuerySchema,
  SourcePauseSchema,
} from "@herald/contracts";
import { SourceSchema } from "@herald/contracts";
import { z } from "zod";

export const DlqIdParamsSchema = z.object({ id: z.uuid() });
export const DeliveryIdParamsSchema = z.object({ delivery_id: z.uuid() });
export const SourceParamsSchema = z.object({ name: SourceSchema });
export const ProviderParamsSchema = z.object({ name: z.string().min(1).max(100) });
export const OutboxQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(["pending", "published", "failed"]).optional(),
});
export const RetriesQuerySchema = PaginationQuerySchema.extend({
  due_only: z.enum(["true", "false"]).optional(),
});
export const DlqQuerySchema = PaginationQuerySchema.extend({
  include_discarded: z.enum(["true", "false"]).optional(),
});
export const AuditQuerySchema = PaginationQuerySchema;

export {
  DlqDiscardSchema as DiscardBodySchema,
  DlqReplaySchema as ReplayBodySchema,
  FaultInjectionSchema as FaultBodySchema,
  SourcePauseSchema as PauseBodySchema,
};
