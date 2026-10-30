import type { DeliveryStatus, NotificationStatus } from "@herald/contracts";

import { applyTransition, type TransitionResult } from "./transition";

const NOTIFICATION_TRANSITIONS: Record<NotificationStatus, readonly NotificationStatus[]> = {
  accepted: ["scheduled", "processing", "canceled", "suppressed"],
  scheduled: ["processing", "canceled", "suppressed"],
  processing: ["partially_delivered", "delivered", "failed", "suppressed"],
  partially_delivered: ["delivered", "failed", "canceled"],
  delivered: [],
  failed: [],
  canceled: [],
  suppressed: [],
};

const DELIVERY_TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  pending: ["sending", "canceled", "suppressed"],
  sending: ["accepted", "delivered", "retry_scheduled", "unknown", "failed"],
  retry_scheduled: ["sending", "canceled", "failed"],
  unknown: ["accepted", "delivered", "retry_scheduled", "failed"],
  accepted: [],
  delivered: [],
  failed: [],
  canceled: [],
  suppressed: [],
};

const TERMINAL_NOTIFICATION = new Set<NotificationStatus>([
  "delivered",
  "failed",
  "canceled",
  "suppressed",
]);

const TERMINAL_DELIVERY = new Set<DeliveryStatus>([
  "accepted",
  "delivered",
  "failed",
  "canceled",
  "suppressed",
]);

const SUCCESS_DELIVERY = new Set<DeliveryStatus>(["accepted", "delivered"]);

export const transitionNotification = (
  current: NotificationStatus,
  next: NotificationStatus,
): TransitionResult<NotificationStatus> =>
  applyTransition(NOTIFICATION_TRANSITIONS, current, next);

export const transitionDelivery = (
  current: DeliveryStatus,
  next: DeliveryStatus,
): TransitionResult<DeliveryStatus> => applyTransition(DELIVERY_TRANSITIONS, current, next);

export const isNotificationTerminal = (status: NotificationStatus): boolean =>
  TERMINAL_NOTIFICATION.has(status);

export const isDeliveryTerminal = (status: DeliveryStatus): boolean => TERMINAL_DELIVERY.has(status);

export const isDeliverySuccess = (status: DeliveryStatus): boolean => SUCCESS_DELIVERY.has(status);

export const aggregateNotificationStatus = (
  current: NotificationStatus,
  deliveryStatuses: readonly DeliveryStatus[],
): NotificationStatus => {
  if (isNotificationTerminal(current) || deliveryStatuses.length === 0) {
    return current;
  }

  const pending = deliveryStatuses.some((status) => !isDeliveryTerminal(status));
  const success = deliveryStatuses.some(isDeliverySuccess);
  const allSuppressed = deliveryStatuses.every((status) => status === "suppressed");

  if (pending) {
    return success ? "partially_delivered" : "processing";
  }

  if (success) {
    return "delivered";
  }

  if (allSuppressed) {
    return "suppressed";
  }

  return "failed";
};
