import { AppError } from "@herald/core";
import type { ValidationIssue } from "@herald/contracts";
import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";

export interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

const toIssues = (error: { issues: Array<{ path: PropertyKey[]; code: string; message: string }> }): ValidationIssue[] =>
  error.issues.map((issue) => ({
    field: issue.path.map(String).join(".") || "_",
    code: issue.code,
    message: issue.message,
  }));

export const validate = (schemas: ValidationSchemas) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const validated: NonNullable<Request["validated"]> = {};

      if (schemas.body) {
        const result = schemas.body.safeParse(req.body);

        if (!result.success) {
          throw new AppError("validation_failed", "Request body is invalid", 422, {
            errors: toIssues(result.error),
          });
        }

        validated.body = result.data;
      }

      if (schemas.query) {
        const result = schemas.query.safeParse(req.query);

        if (!result.success) {
          throw new AppError("validation_failed", "Query string is invalid", 422, {
            errors: toIssues(result.error),
          });
        }

        validated.query = result.data;
      }

      if (schemas.params) {
        const result = schemas.params.safeParse(req.params);

        if (!result.success) {
          throw new AppError("validation_failed", "Path parameters are invalid", 422, {
            errors: toIssues(result.error),
          });
        }

        validated.params = result.data;
      }

      req.validated = validated;
      next();
    } catch (error) {
      next(error);
    }
  };
};
