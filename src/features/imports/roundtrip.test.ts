import { describe, expect, it } from "vitest";
import { toXlsx, toCsv, type ExportColumn } from "@/features/exports/exports";
import { parseWorkbook } from "./parse";
import { suggestMapping, coerceAndValidate } from "./mapping";
import { riskAdapter } from "./adapters/risk";
import { assetAdapter } from "./adapters/asset";
import { RISK_STATUS_LABEL } from "@/features/risks/domain/risks";
import { ASSET_CLASSIFICATION_LABEL, ASSET_VALUE_LABEL } from "@/features/assets/domain/assets";

describe("risk export -> import round-trip", () => {
  it("re-imports every mapped field losslessly through XLSX", async () => {
    type R = { reference: string; description: string; category: string; likelihood: number; impact: number; plan: string; owner: string; status: keyof typeof RISK_STATUS_LABEL; review: string };
    const source: R = { reference: "R-001", description: "Data loss", category: "Operational", likelihood: 3, impact: 4, plan: "Encrypt", owner: "Ada Lovelace", status: "treating", review: "2026-12-31" };
    const columns: ExportColumn<R>[] = [
      { header: "Risk ID", value: (r) => r.reference }, { header: "Risk Description", value: (r) => r.description },
      { header: "Risk Category", value: (r) => r.category }, { header: "Likelihood", value: (r) => r.likelihood },
      { header: "Impact", value: (r) => r.impact }, { header: "Risk Rating", value: (r) => r.likelihood * r.impact },
      { header: "Mitigation Measures", value: (r) => r.plan }, { header: "Risk Owner", value: (r) => r.owner },
      { header: "Status", value: (r) => RISK_STATUS_LABEL[r.status] }, { header: "Review Date", value: (r) => r.review },
    ];
    const buffer = await toXlsx("Risk register", columns, [source]);
    const { headers, rows } = await parseWorkbook(buffer, "xlsx", riskAdapter.fields.map((f) => f.label));
    const [row] = coerceAndValidate(headers, rows, suggestMapping(headers, riskAdapter.fields), riskAdapter.fields, riskAdapter.rowSchema);
    expect(row).toEqual({ ok: true, values: { reference: "R-001", description: "Data loss", categoryName: "Operational", likelihood: 3, impact: 4, treatmentPlan: "Encrypt", ownerName: "Ada Lovelace", status: "treating", reviewDate: "2026-12-31" } });
  });
});

describe("asset export -> import round-trip", () => {
  it("survives the CSV formula-injection apostrophe guard", async () => {
    type A = { reference: string; description: string; category: string; ownerLocation: string; classification: keyof typeof ASSET_CLASSIFICATION_LABEL; value: keyof typeof ASSET_VALUE_LABEL };
    const source: A = { reference: "AST-001", description: "=Customer database", category: "Data", ownerLocation: "HQ", classification: "highly_confidential", value: "high" };
    const columns: ExportColumn<A>[] = [
      { header: "Asset Reference", value: (a) => a.reference }, { header: "Asset Description", value: (a) => a.description },
      { header: "Category", value: (a) => a.category }, { header: "Owner & Location", value: (a) => a.ownerLocation },
      { header: "Classification", value: (a) => ASSET_CLASSIFICATION_LABEL[a.classification] }, { header: "Value (Criticality)", value: (a) => ASSET_VALUE_LABEL[a.value] },
      { header: "Security Controls", value: () => "" }, { header: "Asset Lifespan", value: () => "" }, { header: "Last Updated", value: () => "" }, { header: "Remarks", value: () => "" },
    ];
    const csv = toCsv(columns, [source]); // the description exports as '=Customer database (guarded)
    const { headers, rows } = await parseWorkbook(csv, "csv", assetAdapter.fields.map((f) => f.label));
    const [row] = coerceAndValidate(headers, rows, suggestMapping(headers, assetAdapter.fields), assetAdapter.fields, assetAdapter.rowSchema);
    expect(row.ok).toBe(true);
    if (row.ok) { expect(row.values.description).toBe("=Customer database"); expect(row.values.classification).toBe("highly_confidential"); }
  });
});
