export const TEMPLATE_LIMITS = {
  subject: 200,
  html: 512_000,
  text: 64_000,
} as const;

export interface TemplateContent {
  subject?: string | null;
  html?: string | null;
  text: string;
}

export type RenderResult =
  | {
      ok: true;
      subject: string | null;
      html: string | null;
      text: string;
    }
  | {
      ok: false;
      reason: "missing_variables" | "too_large";
      missing?: string[];
      field?: string;
      limit?: number;
    };

const PLACEHOLDER = /{{\s*([a-zA-Z0-9_.]+)\s*}}/g;

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);

const lookup = (variables: Record<string, unknown>, path: string): unknown =>
  path.split(".").reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== "object") {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, variables);

const stringify = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
};

const collectPlaceholders = (value: string | null | undefined): string[] => {
  if (!value) {
    return [];
  }

  return [...value.matchAll(PLACEHOLDER)].map((match) => match[1] as string);
};

export const templateVariables = (template: TemplateContent): string[] => [
  ...new Set([
    ...collectPlaceholders(template.subject),
    ...collectPlaceholders(template.html),
    ...collectPlaceholders(template.text),
  ]),
];

export const renderTemplate = (
  template: TemplateContent,
  variables: Record<string, unknown>,
): RenderResult => {
  const placeholders = templateVariables(template);
  const missing = [...new Set(placeholders.filter((name) => lookup(variables, name) === undefined))];

  if (missing.length > 0) {
    return { ok: false, reason: "missing_variables", missing: missing.sort() };
  }

  const replace = (value: string, escape: boolean): string =>
    value.replace(PLACEHOLDER, (_match, path: string) => {
      const rendered = stringify(lookup(variables, path));
      return escape ? escapeHtml(rendered) : rendered;
    });

  const subject = template.subject ? replace(template.subject, false).replace(/\s+/g, " ").trim() : null;
  const html = template.html ? replace(template.html, true) : null;
  const text = replace(template.text, false);

  if (subject !== null && subject.length > TEMPLATE_LIMITS.subject) {
    return { ok: false, reason: "too_large", field: "subject", limit: TEMPLATE_LIMITS.subject };
  }

  if (html !== null && html.length > TEMPLATE_LIMITS.html) {
    return { ok: false, reason: "too_large", field: "html", limit: TEMPLATE_LIMITS.html };
  }

  if (text.length > TEMPLATE_LIMITS.text) {
    return { ok: false, reason: "too_large", field: "text", limit: TEMPLATE_LIMITS.text };
  }

  return { ok: true, subject, html, text };
};

export const localeCandidates = (requested: string): string[] => {
  const normalized = requested.trim().replaceAll("_", "-").toLowerCase();
  const [language] = normalized.split("-");
  const candidates = [normalized, language, "en"].filter((value): value is string => Boolean(value));

  return [...new Set(candidates)];
};

export const selectLocalized = <T extends { locale: string }>(
  candidates: readonly T[],
  requested: string,
): T | undefined => {
  for (const locale of localeCandidates(requested)) {
    const match = candidates.find((candidate) => candidate.locale.toLowerCase() === locale);

    if (match) {
      return match;
    }
  }

  return undefined;
};
