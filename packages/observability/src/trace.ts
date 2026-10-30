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

export const currentTrace = (): TraceContext | undefined => storage.getStore();

export const setTraceIds = (ids: Partial<Omit<TraceContext, "traceId">>): void => {
  const context = storage.getStore();

  if (!context) {
    return;
  }

  Object.assign(context, ids);
};
