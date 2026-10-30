import type { Scope } from "@herald/contracts";
import { authenticateApiKey } from "@herald/db";
import { AppError } from "@herald/core";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import { loadConfig } from "@herald/config";

import { prisma } from "../db";

interface UserToken {
  sub: string;
  iss: string;
  aud: string;
}

const bearer = (req: Request): string | null => {
  const header = req.header("authorization");

  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim();
};

export const authenticate = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const token = bearer(req);

  if (!token) {
    throw new AppError("unauthorized", "Missing bearer token", 401);
  }

  if (token.startsWith("hrld_")) {
    const client = await authenticateApiKey(prisma, token);

    if (!client) {
      throw new AppError("unauthorized", "Invalid or expired API key", 401);
    }

    req.apiClient = client;
    next();
    return;
  }

  try {
    const payload = jwt.verify(token, loadConfig().jwtSecret, {
      issuer: "herald",
      audience: "herald-user",
    }) as UserToken;

    if (!payload.sub) {
      throw new AppError("unauthorized", "Token has no subject", 401);
    }

    req.userId = payload.sub;
    next();
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError("unauthorized", "Invalid or expired token", 401);
  }
};

export const requireScope = (scope: Scope) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.apiClient) {
      throw new AppError("forbidden", "This endpoint requires a service key", 403);
    }

    if (!req.apiClient.scopes.includes(scope)) {
      throw new AppError("forbidden", `Missing scope ${scope}`, 403);
    }

    next();
  };
};

export const requireServiceKey = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.apiClient) {
    throw new AppError("forbidden", "This endpoint requires a service key", 403);
  }

  next();
};

export const requireUser = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.userId || req.apiClient) {
    throw new AppError("forbidden", "This endpoint requires a user token", 403);
  }

  next();
};
