import { AppError } from "@herald/core";
import { metricsContentType, metricsText } from "@herald/observability";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";

import { errorMiddleware } from "./core/middleware/error.middleware";
import { metricsMiddleware } from "./core/middleware/metrics.middleware";
import { requestLogger } from "./core/middleware/request-logger.middleware";
import { traceMiddleware } from "./core/middleware/trace.middleware";
import { buildOpenApiDocument, scalarHtml } from "./core/openapi";
import { demoRouter, keysRouter, whoamiRouter } from "./modules/auth/auth.route";
import campaignRouter from "./modules/campaign/campaign.route";
import catalogRouter, { adminRouter as catalogAdminRouter } from "./modules/catalog/catalog.route";
import consumerRouter from "./modules/consumer/consumer.route";
import eventRouter from "./modules/event/event.route";
import { healthRouter } from "./modules/health/health.route";
import notificationRouter from "./modules/notification/notification.route";
import opsRouter from "./modules/ops/ops.route";
import { adminRouter as templateAdminRouter, readRouter as templateRouter } from "./modules/template/template.route";
import { webhookRouter } from "./modules/webhook/webhook.route";

export const createApp = (): Express => {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", true);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors({ origin: true }));

  app.use(traceMiddleware);
  app.use(metricsMiddleware);
  app.use(requestLogger);

  app.use("/v1/webhooks", webhookRouter);

  app.use(express.json({ limit: "10mb" }));

  app.use("/health", healthRouter);

  app.get("/metrics", async (_req, res) => {
    res.setHeader("Content-Type", metricsContentType());
    res.send(await metricsText());
  });

  app.get("/openapi.json", (_req, res) => {
    res.json(buildOpenApiDocument());
  });

  app.get("/docs", (_req, res) => {
    res.type("html").send(scalarHtml());
  });

  app.use("/v1/events", eventRouter);
  app.use("/v1/notifications", notificationRouter);
  app.use("/v1/catalog", catalogRouter);
  app.use("/v1/catalog", templateRouter);
  app.use("/v1/campaigns", campaignRouter);
  app.use("/v1/ops", opsRouter);
  app.use("/v1/me", consumerRouter);
  app.use("/v1/demo", demoRouter);
  app.use("/v1/whoami", whoamiRouter);

  app.use("/v1/admin/keys", keysRouter);
  app.use("/v1/admin", catalogAdminRouter);
  app.use("/v1/admin", templateAdminRouter);

  app.use((_req, _res, next) => {
    next(new AppError("not_found", "Route not found", 404));
  });

  app.use(errorMiddleware);

  return app;
};
