import Ajv, { type ErrorObject } from "ajv";

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
const compiled = new Map<string, ReturnType<typeof ajv.compile>>();

export interface JsonSchemaResult {
  ok: boolean;
  errors: Array<{ field: string; message: string }>;
}

export const validateJsonSchema = (
  schema: Record<string, unknown> | undefined,
  value: unknown,
): JsonSchemaResult => {
  if (!schema || Object.keys(schema).length === 0) {
    return { ok: true, errors: [] };
  }

  const key = JSON.stringify(schema);
  let validator = compiled.get(key);

  if (!validator) {
    validator = ajv.compile(schema);
    compiled.set(key, validator);
  }

  if (validator(value)) {
    return { ok: true, errors: [] };
  }

  return {
    ok: false,
    errors: (validator.errors ?? []).map((error: ErrorObject) => ({
      field: error.instancePath.replace(/^\//, "").replaceAll("/", ".") || "_",
      message: error.message ?? "is invalid",
    })),
  };
};
