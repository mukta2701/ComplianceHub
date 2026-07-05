import { describe, expect, it } from "vitest";
import { riskAdapter } from "./risk";
import { coerceAndValidate, suggestMapping } from "../mapping";

const HEADERS = ["Risk ID", "Risk Description", "Risk Category", "Likelihood", "Impact", "Mitigation Measures", "Risk Owner", "Status", "Review Date"];

describe("riskAdapter", () => {
  it("auto-maps the exported risk headers", () => {
    const mapping = suggestMapping(HEADERS, riskAdapter.fields);
    expect(mapping["Risk Category"]).toBe("categoryName");
    expect(mapping["Mitigation Measures"]).toBe("treatmentPlan");
    expect(mapping["Status"]).toBe("status");
  });
  it("coerces a full valid row (status label -> enum, 1-5 ints, DD/MM/YYYY date)", () => {
    const mapping = suggestMapping(HEADERS, riskAdapter.fields);
    const [row] = coerceAndValidate(HEADERS, [["R-001", "Data loss", "Operational", "3", "2", "Encrypt", "Ada Lovelace", "Treating", "31/12/2026"]], mapping, riskAdapter.fields, riskAdapter.rowSchema);
    expect(row).toEqual({ ok: true, values: { reference: "R-001", description: "Data loss", categoryName: "Operational", likelihood: 3, impact: 2, treatmentPlan: "Encrypt", ownerName: "Ada Lovelace", status: "treating", reviewDate: "2026-12-31" } });
  });
  it("rejects an out-of-range likelihood and an unknown status but keeps a blank reference/owner", () => {
    const mapping = suggestMapping(HEADERS, riskAdapter.fields);
    const [row] = coerceAndValidate(HEADERS, [["", "Data loss", "Operational", "9", "2", "", "", "Wibble", ""]], mapping, riskAdapter.fields, riskAdapter.rowSchema);
    expect(row.ok).toBe(false);
    if (!row.ok) expect(row.errors).toEqual(["Likelihood: must be a whole number 1–5", 'Status: unrecognised value "Wibble"']);
  });
});
