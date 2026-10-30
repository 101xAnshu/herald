import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "./app";

const app = createApp();

describe("api surface", () => {
  it("reports liveness", async () => {
    const response = await request(app).get("/health/live");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "ok" });
  });

  it("serves the OpenAPI document", async () => {
    const response = await request(app).get("/openapi.json");

    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe("3.1.0");
    expect(response.body.paths["/v1/events"].post).toBeDefined();
  });

  it("serves the interactive docs", async () => {
    const response = await request(app).get("/docs");

    expect(response.status).toBe(200);
    expect(response.text).toContain("@scalar/api-reference");
  });

  it("rejects a request without credentials", async () => {
    const response = await request(app).post("/v1/events").send({});

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("unauthorized");
    expect(typeof response.body.trace_id).toBe("string");
    expect(response.headers["x-trace-id"]).toBe(response.body.trace_id);
  });

  it("returns a stable error envelope for unknown routes", async () => {
    const response = await request(app).get("/v1/missing");

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: { code: "not_found", message: "Route not found" },
    });
  });
});
