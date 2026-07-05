import { describe, expect, it } from "vitest";
import { assetAdapter } from "./asset";
import { ADAPTERS } from "./index";
import { coerceAndValidate, suggestMapping } from "../mapping";

const HEADERS = ["Asset Reference", "Asset Description", "Category", "Owner & Location", "Classification", "Value (Criticality)", "Security Controls", "Asset Lifespan", "Last Updated", "Remarks"];

describe("assetAdapter", () => {
  it("coerces 'Highly Confidential' -> highly_confidential and 'High' -> high", () => {
    const mapping = suggestMapping(HEADERS, assetAdapter.fields);
    const [row] = coerceAndValidate(HEADERS, [["AST-001", "Customer database", "Data", "HQ", "Highly Confidential", "High", "TLS", "3 years", "2026-01-05", "n/a"]], mapping, assetAdapter.fields, assetAdapter.rowSchema);
    expect(row).toEqual({ ok: true, values: { reference: "AST-001", description: "Customer database", categoryName: "Data", ownerLocation: "HQ", classification: "highly_confidential", valueCriticality: "high", securityControls: "TLS", lifespan: "3 years", lastUpdated: "2026-01-05", remarks: "n/a" } });
  });
  it("rejects an unrecognised classification", () => {
    const mapping = suggestMapping(HEADERS, assetAdapter.fields);
    const [row] = coerceAndValidate(HEADERS, [["", "X", "", "", "Ultra Secret", "High", "", "", "", ""]], mapping, assetAdapter.fields, assetAdapter.rowSchema);
    expect(row.ok).toBe(false);
    if (!row.ok) expect(row.errors).toContain('Classification: unrecognised value "Ultra Secret"');
  });
});

describe("ADAPTERS registry", () => {
  it("exposes all three modules keyed by name", () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual(["asset", "risk", "soa"]);
    expect(ADAPTERS.asset.label).toBe("Asset inventory");
  });
});
