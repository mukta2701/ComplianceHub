import { describe, expect, it } from "vitest";
import { z } from "zod";
import { reverseLabels, textField, enumField, intField, boolField, dateField, suggestMapping, coerceAndValidate, type TargetField } from "./mapping";

const STATUS = { open: "Open", closed: "Closed" } as const;

describe("reverseLabels", () => {
  it("accepts the exported label and the raw enum key, case-insensitively", () => {
    const rev = reverseLabels(STATUS);
    expect(rev("Open")).toBe("open");
    expect(rev("open")).toBe("open");
    expect(rev("CLOSED")).toBe("closed");
    expect(rev("nope")).toBe(null);
  });
});

describe("field builders", () => {
  it("coerce enums, 1-5 ints, Yes/No and dates", () => {
    expect(enumField("s", "Status", true, [], STATUS).coerce("Closed")).toEqual({ ok: true, value: "closed" });
    expect(enumField("s", "Status", true, [], STATUS).coerce("bad")).toEqual({ ok: false, error: 'unrecognised value "bad"' });
    expect(intField("l", "Likelihood", true, []).coerce("4")).toEqual({ ok: true, value: 4 });
    expect(intField("l", "Likelihood", true, []).coerce("6")).toEqual({ ok: false, error: "must be a whole number 1–5" });
    expect(boolField("a", "Applicable", true, []).coerce("Yes")).toEqual({ ok: true, value: true });
    expect(boolField("a", "Applicable", true, []).coerce("no")).toEqual({ ok: true, value: false });
    expect(dateField("d", "Review Date", false, []).coerce("31/12/2026")).toEqual({ ok: true, value: "2026-12-31" });
    expect(dateField("d", "Review Date", false, []).coerce("2026-12-31")).toEqual({ ok: true, value: "2026-12-31" });
    expect(dateField("d", "Review Date", false, []).coerce("nope")).toEqual({ ok: false, error: "must be a date (DD/MM/YYYY or YYYY-MM-DD)" });
  });

  it("rejects calendar-invalid dates that merely match the shape (e.g. 31 Feb, month 13)", () => {
    expect(dateField("d", "Review Date", false, []).coerce("31/02/2026")).toEqual({ ok: false, error: "must be a date (DD/MM/YYYY or YYYY-MM-DD)" });
    expect(dateField("d", "Review Date", false, []).coerce("2026-13-40")).toEqual({ ok: false, error: "must be a date (DD/MM/YYYY or YYYY-MM-DD)" });
    // still accepts real dates, including the Feb 29 on a leap year
    expect(dateField("d", "Review Date", false, []).coerce("29/02/2028")).toEqual({ ok: true, value: "2028-02-29" });
    expect(dateField("d", "Review Date", false, []).coerce("28/02/2026")).toEqual({ ok: true, value: "2026-02-28" });
  });
});

describe("suggestMapping", () => {
  it("matches headers to fields by label/alias ignoring case, spacing and punctuation", () => {
    const fields: TargetField[] = [textField("reference", "Risk ID", false, ["Reference"]), textField("description", "Risk Description", true, [])];
    expect(suggestMapping(["risk id", "Risk  Description", "Extra"], fields)).toEqual({ "risk id": "reference", "Risk  Description": "description", Extra: null });
  });
});

describe("coerceAndValidate", () => {
  const fields: TargetField[] = [textField("description", "Risk Description", true, []), intField("likelihood", "Likelihood", true, [])];
  it("reports required-field and coercion errors per row and never silently drops a row", () => {
    const headers = ["Risk Description", "Likelihood"];
    const mapping = { "Risk Description": "description", Likelihood: "likelihood" } as const;
    const out = coerceAndValidate(headers, [["Data loss", "3"], ["", "9"]], mapping, fields);
    expect(out[0]).toEqual({ ok: true, values: { description: "Data loss", likelihood: 3 } });
    expect(out[1]).toEqual({ ok: false, errors: ["Risk Description is required", "Likelihood: must be a whole number 1–5"] });
  });
  it("applies an optional row schema (cross-field refine) after coercion", () => {
    const rowSchema = z.object({ description: z.string(), likelihood: z.number() }).refine((v) => v.likelihood <= 5, { message: "Likelihood too high" });
    const out = coerceAndValidate(["Risk Description", "Likelihood"], [["ok", "3"]], { "Risk Description": "description", Likelihood: "likelihood" }, fields, rowSchema);
    expect(out[0].ok).toBe(true);
  });
  it("treats a short row (fewer cells than headers) as empty for the missing column, without crashing", () => {
    const out = coerceAndValidate(["Risk Description", "Likelihood"], [["Only one cell"]], { "Risk Description": "description", Likelihood: "likelihood" }, fields);
    expect(out[0]).toEqual({ ok: false, errors: ["Likelihood is required"] });
  });
});
