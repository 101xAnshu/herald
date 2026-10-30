import { describe, expect, it } from "vitest";

import {
  escapeHtml,
  localeCandidates,
  renderTemplate,
  selectLocalized,
  templateVariables,
} from "./template";

describe("template rendering", () => {
  const template = {
    subject: "Booking {{ booking_id }} confirmed",
    html: "<p>Hi {{ name }}, your {{ service }} is booked.</p>",
    text: "Hi {{ name }}, your {{ service }} is booked.",
  };

  it("renders variables and escapes HTML values only", () => {
    const result = renderTemplate(template, {
      booking_id: "bkg_1",
      name: "<script>alert(1)</script>",
      service: "plumbing",
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.subject).toBe("Booking bkg_1 confirmed");
      expect(result.html).toContain("&lt;script&gt;");
      expect(result.text).toContain("<script>");
    }
  });

  it("reports missing variables", () => {
    const result = renderTemplate(template, { name: "Anshu" });

    expect(result).toEqual({
      ok: false,
      reason: "missing_variables",
      missing: ["booking_id", "service"],
    });
  });

  it("supports nested variables", () => {
    const result = renderTemplate(
      { text: "Hello {{ user.name }}" },
      { user: { name: "Anshu" } },
    );

    expect(result).toEqual({ ok: true, subject: null, html: null, text: "Hello Anshu" });
  });

  it("collects unique placeholders", () => {
    expect(templateVariables({ subject: "{{a}}", html: "{{a}} {{b}}", text: "{{c}}" })).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("refuses oversized output", () => {
    const result = renderTemplate({ text: "{{value}}" }, { value: "x".repeat(64_001) });

    expect(result).toMatchObject({ ok: false, reason: "too_large", field: "text" });
  });

  it("escapes the five HTML characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("locale fallback", () => {
  it("tries exact, language, then default", () => {
    expect(localeCandidates("en-IN")).toEqual(["en-in", "en"]);
    expect(localeCandidates("fr")).toEqual(["fr", "en"]);
  });

  it("selects the best available template", () => {
    const templates = [
      { id: "default", locale: "en" },
      { id: "language", locale: "en" },
      { id: "exact", locale: "en-in" },
    ];

    expect(selectLocalized(templates, "en-IN")?.id).toBe("exact");
    expect(selectLocalized([{ id: "default", locale: "en" }], "hi-IN")?.id).toBe("default");
    expect(selectLocalized([], "hi-IN")).toBeUndefined();
  });
});
