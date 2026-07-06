import { describe, expect, it } from "vitest";
import { POLICY_TEMPLATES, policyTemplateBySlug } from "./templates";

describe("POLICY_TEMPLATES", () => {
  it("ships a usable starter set", () => {
    expect(POLICY_TEMPLATES.length).toBeGreaterThanOrEqual(8);
  });

  it("gives every template non-empty, within-limit fields", () => {
    for (const template of POLICY_TEMPLATES) {
      expect(template.slug.trim().length).toBeGreaterThan(0);
      expect(template.reference.trim().length).toBeGreaterThan(0);
      expect(template.title.trim().length).toBeGreaterThan(0);
      expect(template.summary.trim().length).toBeGreaterThan(0);
      expect(template.body.trim().length).toBeGreaterThan(0);
      // Must satisfy the same limits the create action enforces.
      expect(template.reference.length).toBeLessThanOrEqual(40);
      expect(template.title.length).toBeLessThanOrEqual(200);
      expect(template.body.length).toBeLessThanOrEqual(100_000);
    }
  });

  it("keeps references and slugs unique", () => {
    const references = POLICY_TEMPLATES.map((template) => template.reference);
    const slugs = POLICY_TEMPLATES.map((template) => template.slug);
    expect(new Set(references).size).toBe(references.length);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("policyTemplateBySlug", () => {
  it("returns the matching template", () => {
    const template = policyTemplateBySlug("information-security");
    expect(template?.reference).toBe("POL-001");
    expect(template?.title).toBe("Information Security Policy");
  });

  it("returns undefined for an unknown slug", () => {
    expect(policyTemplateBySlug("does-not-exist")).toBeUndefined();
    expect(policyTemplateBySlug("")).toBeUndefined();
  });
});
