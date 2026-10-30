import type { NotificationListQuery } from "@herald/contracts";
import type { Request, Response } from "express";

import { sendSuccess } from "../../core/http/response";
import * as service from "./notification.service";

const params = (req: Request) => req.validated?.params as { id: string };

export const listNotificationsController = async (req: Request, res: Response): Promise<void> => {
  const query = req.validated?.query as NotificationListQuery;
  const page = await service.listNotificationPage(query);
  sendSuccess(res, page.items, 200, page.meta);
};

export const getNotificationController = async (req: Request, res: Response): Promise<void> => {
  const detail = await service.notificationDetail(params(req).id);
  sendSuccess(res, { notification: detail.notification, deliveries: detail.deliveries });
};

export const getTraceController = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.notificationTrace(params(req).id));
};

export const getDeliveriesController = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.notificationDeliveries(params(req).id));
};

export const cancelNotificationController = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.cancel(params(req).id));
};

export const retryNotificationController = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(res, await service.retry(params(req).id));
};
