import {
  CampaignCreateSchema,
  DemoTokenSchema,
  ErrorEnvelopeSchema,
  IngestEventSchema,
  NotificationListQuerySchema,
  QuietHoursSchema,
  UpdatePreferencesSchema,
} from "@herald/contracts";
import { z } from "zod";

const schemaOf = (schema: z.ZodType): Record<string, unknown> => {
  const json = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete json["$schema"];
  return json;
};

const jsonResponse = (description: string, schema?: Record<string, unknown>) => ({
  description,
  content: {
    "application/json": {
      schema: schema ?? { type: "object" },
    },
  },
});

const unauthorized = jsonResponse("Missing or invalid credentials", {
  $ref: "#/components/schemas/ErrorEnvelope",
});

const envelope = (data: Record<string, unknown>) => ({
  type: "object",
  required: ["data", "trace_id"],
  properties: {
    data,
    trace_id: { type: "string" },
  },
});

export const buildOpenApiDocument = (): Record<string, unknown> => ({
  openapi: "3.1.0",
  info: {
    title: "Herald",
    version: "1.0.0",
    description:
      "Multi-channel notification platform. Send transactional events, run campaigns, inspect delivery traces, and stream the in-app inbox.",
  },
  servers: [{ url: "http://localhost:3000", description: "Local stack" }],
  tags: [
    { name: "events" },
    { name: "notifications" },
    { name: "catalog" },
    { name: "campaigns" },
    { name: "consumer" },
    { name: "ops" },
    { name: "webhooks" },
  ],
  components: {
    securitySchemes: {
      serviceKey: { type: "http", scheme: "bearer", description: "Service API key" },
      userToken: { type: "http", scheme: "bearer", description: "Short-lived user JWT" },
    },
    schemas: {
      IngestEvent: schemaOf(IngestEventSchema),
      CampaignCreate: schemaOf(CampaignCreateSchema),
      DemoToken: schemaOf(DemoTokenSchema),
      QuietHours: schemaOf(QuietHoursSchema),
      UpdatePreferences: schemaOf(UpdatePreferencesSchema),
      NotificationListQuery: schemaOf(NotificationListQuerySchema),
      ErrorEnvelope: schemaOf(ErrorEnvelopeSchema),
      AcceptedEvent: envelope({
        type: "object",
        properties: {
          notification_id: { type: "string", format: "uuid" },
          status: { type: "string", enum: ["accepted"] },
          trace_id: { type: "string" },
        },
      }),
      Notification: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          user_id: { type: "string", format: "uuid" },
          source: { type: "string" },
          event_type: { type: "string" },
          priority: { type: "string" },
          status: { type: "string" },
          created_at: { type: "string", format: "date-time" },
        },
      },
    },
  },
  security: [{ serviceKey: [] }],
  paths: {
    "/v1/events": {
      post: {
        tags: ["events"],
        summary: "Accept one event",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/IngestEvent" } } },
        },
        responses: {
          "202": jsonResponse("Event accepted", { $ref: "#/components/schemas/AcceptedEvent" }),
          "401": unauthorized,
          "409": jsonResponse("Idempotency conflict or paused source", {
            $ref: "#/components/schemas/ErrorEnvelope",
          }),
          "422": jsonResponse("Validation failed", { $ref: "#/components/schemas/ErrorEnvelope" }),
        },
      },
    },
    "/v1/events/batch": {
      post: {
        tags: ["events"],
        summary: "Accept up to 1,000 events",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["events"],
                properties: {
                  events: {
                    type: "array",
                    maxItems: 1000,
                    items: { $ref: "#/components/schemas/IngestEvent" },
                  },
                },
              },
            },
          },
        },
        responses: { "202": jsonResponse("Per-item results") },
      },
    },
    "/v1/notifications": {
      get: {
        tags: ["notifications"],
        summary: "List notifications",
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", maximum: 100 } },
          { name: "source", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": jsonResponse("Notification page") },
      },
    },
    "/v1/notifications/{id}": {
      get: {
        tags: ["notifications"],
        summary: "Notification detail",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": jsonResponse("Notification and deliveries"), "404": jsonResponse("Not found") },
      },
    },
    "/v1/notifications/{id}/trace": {
      get: {
        tags: ["notifications"],
        summary: "Full notification timeline",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": jsonResponse("Timeline") },
      },
    },
    "/v1/notifications/{id}/cancel": {
      post: {
        tags: ["notifications"],
        summary: "Cancel non-terminal deliveries",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": jsonResponse("Canceled") },
      },
    },
    "/v1/notifications/{id}/retry": {
      post: {
        tags: ["notifications"],
        summary: "Re-drive failed deliveries",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": jsonResponse("Retried") },
      },
    },
    "/v1/catalog/event-types": {
      get: {
        tags: ["catalog"],
        summary: "List event types",
        responses: { "200": jsonResponse("Event types") },
      },
    },
    "/v1/catalog/templates": {
      get: {
        tags: ["catalog"],
        summary: "List templates",
        responses: { "200": jsonResponse("Templates") },
      },
    },
    "/v1/campaigns": {
      get: {
        tags: ["campaigns"],
        summary: "List campaigns",
        responses: { "200": jsonResponse("Campaigns") },
      },
      post: {
        tags: ["campaigns"],
        summary: "Create a campaign",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CampaignCreate" } } },
        },
        responses: { "201": jsonResponse("Created") },
      },
    },
    "/v1/campaigns/{id}/stats": {
      get: {
        tags: ["campaigns"],
        summary: "Campaign funnel",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": jsonResponse("Funnel") },
      },
    },
    "/v1/me/inbox": {
      get: {
        tags: ["consumer"],
        summary: "Cursor-paginated inbox",
        security: [{ userToken: [] }],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", maximum: 100 } },
          { name: "unread", in: "query", schema: { type: "boolean" } },
        ],
        responses: { "200": jsonResponse("Inbox page") },
      },
    },
    "/v1/me/inbox/stream": {
      get: {
        tags: ["consumer"],
        summary: "Server-sent events for new inbox items",
        security: [{ userToken: [] }],
        responses: {
          "200": { description: "text/event-stream", content: { "text/event-stream": {} } },
        },
      },
    },
    "/v1/demo/token": {
      post: {
        tags: ["consumer"],
        summary: "Mint a short-lived user token when demo mode is enabled",
        security: [],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/DemoToken" } } },
        },
        responses: { "200": jsonResponse("Token") },
      },
    },
    "/v1/ops/stats": {
      get: {
        tags: ["ops"],
        summary: "Counts, outbox lag, DLQ, and campaign progress",
        responses: { "200": jsonResponse("Stats") },
      },
    },
    "/v1/ops/dlq": {
      get: {
        tags: ["ops"],
        summary: "List dead letters",
        responses: { "200": jsonResponse("Dead letters") },
      },
    },
    "/v1/webhooks/{provider}": {
      post: {
        tags: ["webhooks"],
        summary: "Provider callback with an HMAC signature",
        security: [],
        parameters: [{ name: "provider", in: "path", required: true, schema: { type: "string" } }],
        responses: { "202": jsonResponse("Accepted") },
      },
    },
  },
});

export const scalarHtml = (): string => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Herald API</title>
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <script id="api-reference" data-url="/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`;
