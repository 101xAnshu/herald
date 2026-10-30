import { checkKafka } from "@herald/queue";
import type { Request, Response } from "express";
import { Router } from "express";

import { databaseReady, migrationsReady } from "../../core/db";
import { redis } from "../../core/middleware/rate-limit.middleware";

const startedAt = Date.now();

const ready = async (): Promise<{ ok: boolean; checks: Record<string, boolean> }> => {
  const [database, redisReady, kafka, migrations] = await Promise.all([
    databaseReady(),
    redis().ping(),
    checkKafka().catch(() => false),
    migrationsReady(),
  ]);

  const checks = { database, redis: redisReady, kafka, migrations };

  return { ok: Object.values(checks).every(Boolean), checks };
};

export const healthRouter: Router = Router();

healthRouter.get("/live", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", uptime_seconds: Math.floor((Date.now() - startedAt) / 1000) });
});

healthRouter.get("/ready", async (_req: Request, res: Response) => {
  const result = await ready();
  res.status(result.ok ? 200 : 503).json({
    status: result.ok ? "ready" : "degraded",
    checks: result.checks,
  });
});
