import { AsyncLocalStorage } from "node:async_hooks";

export interface TraceContext {
  traceId: string;
  notificationId?: string;
  deliveryId?: string;
  campaignId?: string;
}

const storage = new AsyncLocalStorage<TraceContext>();

export const runWithTrace = <T>(context: TraceContext, callback: () => T): T =>
  storage.run(context, callback);
