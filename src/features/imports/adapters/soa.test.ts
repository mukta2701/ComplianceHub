import { describe, expect, it } from "vitest";
import { soaAdapter } from "./soa";
import { coerceAndValidate, suggestMapping } from "../mapping";

const HEADERS = ["Control Number", "Is Control Applicable?", "Justification for the Inclusion/Exclusion", "Implementation Status", "Owner", "Comments"];

describe("soaAdapter", () => {
  it("auto-maps the exported SoA headers", () => {
    const mapping = suggestMapping(HEADERS, soaAdapter.fields);
    expect(mapping["Control Number"]).toBe("controlCode");
    expect(mapping["Is Control Applicable?"]).toBe("applicable");
    expect(mapping["Implementation Status"]).toBe("status");
  });
  it("coerces Yes/No -> bool and the 7-value status label -> enum", () => {
    const mapping = suggestMapping(HEADERS, soaAdapter.fields);
    const [row] = coerceAndValidate(HEADERS, [["A.5.1", "Yes", "Policy exists", "In Progress", "Ada Lovelace", "note"]], mapping, soaAdapter.fields, soaAdapter.rowSchema);
    expect(row).toEqual({ ok: true, values: { controlCode: "A.5.1", applicable: true, justification: "Policy exists", status: "in_progress", ownerName: "Ada Lovelace", comments: "note" } });
  });
  it("rejects an applicable=No row whose status is not 'Not Applicable'", () => {
    const mapping = suggestMapping(HEADERS, soaAdapter.fields);
    const [row] = coerceAndValidate(HEADERS, [["A.9.1", "No", "Out of scope", "Operational", "", ""]], mapping, soaAdapter.fields, soaAdapter.rowSchema);
    expect(row.ok).toBe(false);
    if (!row.ok) expect(row.errors).toContain("Status must match applicability");
  });
  it("rejects a row missing the control number match key", () => {
    const mapping = suggestMapping(HEADERS, soaAdapter.fields);
    const [row] = coerceAndValidate(HEADERS, [["", "Yes", "Policy exists", "In Progress", "", ""]], mapping, soaAdapter.fields, soaAdapter.rowSchema);
    expect(row.ok).toBe(false);
    if (!row.ok) expect(row.errors).toContain("Control Number is required");
  });
});
