import type { BatchItemResult, IngestEvent, Source } from "@herald/contracts";
import { IngestEventSchema } from "@herald/contracts";
import { AppError } from "@herald/core";
import { ingestEvent } from "@herald/db";
import { dedupeHits, eventsAccepted, eventsRejected } from "@herald/observability";

const MAX_EVENT_BYTES = 64 * 1024;

export const acceptEvent = async (input: {
  source: Source;
  event: IngestEvent;
  traceId: string;
  actor: string;
}) => {
  if (Buffer.byteLength(JSON.stringify(input.event), "utf8") > MAX_EVENT_BYTES) {
    eventsRejected.inc({ reason: "payload_too_large", source: input.source });
    throw new AppError("validation_failed", "Event payload exceeds 64 KB", 422);
  }

  try {
    const result = await ingestEvent({
      source: input.source,
      event: input.event,
      traceId: input.traceId,
      actor: input.actor,
    });

    if (result.duplicate) {
      dedupeHits.inc({ source: input.source });
    }

    eventsAccepted.inc({
      event_type: input.event.type,
      priority: input.event.priority ?? "normal",
      source: input.source,
    });

    return result;
  } catch (error) {
    if (error instanceof AppError) {
      eventsRejected.inc({ reason: error.code, source: input.source });
    }

    throw error;
  }
};

export const acceptBatch = async (input: {
  source: Source;
  events: unknown[];
  traceId: string;
  actor: string;
}): Promise<{
  accepted: number;
  rejected: number;
  results: BatchItemResult[];
  trace_id: string;
}> => {
  const results: BatchItemResult[] = [];
  let accepted = 0;
  let rejected = 0;

  for (const [index, raw] of input.events.entries()) {
    const parsed = IngestEventSchema.safeParse(raw);

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      rejected += 1;
      results.push({
        index,
        status: "rejected",
        code: "validation_failed",
        message: issue?.message ?? "Invalid event",
        field: issue?.path.map(String).join("."),
      });
      continue;
    }

    try {
      const result = await acceptEvent({
        source: input.source,
        event: parsed.data,
        traceId: input.traceId,
        actor: input.actor,
      });

      accepted += 1;
      results.push({ index, status: "accepted", notification_id: result.notificationId });
    } catch (error) {
      rejected += 1;
      results.push({
        index,
        status: "rejected",
        code: error instanceof AppError ? error.code : "internal_error",
        message: error instanceof Error ? error.message : "Event rejected",
      });
    }
  }

  return { accepted, rejected, results, trace_id: input.traceId };
};
