import { EVENT_CATALOG, type CreateTemplate, type CreateTemplateVersion } from "@herald/contracts";
import { AppError, renderTemplate } from "@herald/core";
import {
  channelFromDb,
  createTemplate,
  createTemplateVersion,
  getTemplateWithVersion,
  ingestEvent,
  listTemplates,
  prisma,
  publishTemplateVersion,
} from "@herald/db";

const EVENT_FOR_TEMPLATE: Record<string, string> = {
  booking_confirmation: "booking.confirmed",
  booking_cancellation: "booking.canceled",
  payment_failure: "payment.failed",
  security_alert: "security.alert",
  winback: "campaign.message",
};

const templateView = (row: {
  id: string;
  key: string;
  channel: string;
  locale: string;
  name: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  currentVersion: {
    id: string;
    version: number;
    subject: string | null;
    html: string;
    text: string;
    variablesSchema: unknown;
    publishedAt: Date | null;
    createdAt: Date;
  } | null;
}) => ({
  id: row.id,
  key: row.key,
  channel: channelFromDb(row.channel as never),
  locale: row.locale,
  name: row.name,
  status: row.status.toLowerCase(),
  created_at: row.createdAt.toISOString(),
  updated_at: row.updatedAt.toISOString(),
  current_version: row.currentVersion
    ? {
        id: row.currentVersion.id,
        version: row.currentVersion.version,
        subject: row.currentVersion.subject,
        html: row.currentVersion.html,
        text: row.currentVersion.text,
        variables_schema: row.currentVersion.variablesSchema,
        published_at: row.currentVersion.publishedAt?.toISOString() ?? null,
        created_at: row.currentVersion.createdAt.toISOString(),
      }
    : null,
});

export const listCatalogTemplates = async () => {
  const rows = await listTemplates(prisma);
  return rows.map(templateView);
};

export const getCatalogTemplate = async (id: string) => {
  const row = await getTemplateWithVersion(prisma, id);

  if (!row) {
    throw new AppError("not_found", "Template not found", 404);
  }

  return {
    ...templateView(row),
    versions: row.versions.map((version) => ({
      id: version.id,
      version: version.version,
      subject: version.subject,
      published_at: version.publishedAt?.toISOString() ?? null,
      created_at: version.createdAt.toISOString(),
    })),
  };
};

export const addTemplate = async (input: CreateTemplate) => {
  const row = await createTemplate(prisma, input);
  return templateView({ ...row, currentVersion: null });
};

export const addTemplateVersion = async (
  templateId: string,
  input: CreateTemplateVersion,
  actor: string,
) => {
  const version = await createTemplateVersion(prisma, templateId, input, actor);
  return {
    id: version.id,
    template_id: version.templateId,
    version: version.version,
    created_at: version.createdAt.toISOString(),
  };
};

export const publishVersion = async (templateId: string, versionId: string) => {
  const updated = await publishTemplateVersion(prisma, templateId, versionId);
  return templateView(updated);
};

export const previewTemplate = async (
  templateId: string,
  input: { version_id?: string; data: Record<string, unknown> },
) => {
  const template = await getTemplateWithVersion(prisma, templateId);

  if (!template) {
    throw new AppError("not_found", "Template not found", 404);
  }

  const version = input.version_id
    ? template.versions.find((candidate) => candidate.id === input.version_id)
    : template.currentVersion;

  if (!version) {
    throw new AppError("not_found", "Template version not found", 404);
  }

  const rendered = renderTemplate(
    { subject: version.subject, html: version.html, text: version.text },
    input.data,
  );

  if (!rendered.ok) {
    throw new AppError("validation_failed", "Template could not be rendered", 422, {
      details: { reason: rendered.reason, missing: rendered.missing, field: rendered.field },
    });
  }

  return rendered;
};

export const sendTemplateTest = async (
  templateId: string,
  input: { external_id: string; data: Record<string, unknown> },
  traceId: string,
) => {
  const template = await getTemplateWithVersion(prisma, templateId);

  if (!template) {
    throw new AppError("not_found", "Template not found", 404);
  }

  const eventTypeKey = EVENT_FOR_TEMPLATE[template.key];

  if (!eventTypeKey) {
    throw new AppError("validation_failed", "Template is not linked to an event type", 422);
  }

  const eventType = EVENT_CATALOG.find((candidate) => candidate.key === eventTypeKey);

  if (!eventType) {
    throw new AppError("validation_failed", "Event type is not configured", 422);
  }

  return ingestEvent({
    source: eventType.allowed_sources[0] as never,
    event: {
      type: eventTypeKey,
      schema_version: 1,
      recipient: { external_id: input.external_id },
      idempotency_key: `template-test:${templateId}:${Date.now()}`,
      data: { ...input.data, template_key: template.key },
    },
    traceId,
    actor: "template-test",
  });
};
