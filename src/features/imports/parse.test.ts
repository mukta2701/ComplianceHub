import { describe, expect, it } from "vitest";
import { parseCsv, findHeaderRow, parseWorkbook } from "./parse";
import { toXlsx, type ExportColumn } from "@/features/exports/exports";

describe("parseCsv", () => {
  it("splits rows and honours quotes, escaped quotes, embedded commas and newlines", () => {
    const csv = 'Alpha,Beta\r\n"x,""y""\nz",3\r\nplain,';
    expect(parseCsv(csv)).toEqual([["Alpha", "Beta"], ['x,"y"\nz', "3"], ["plain", ""]]);
  });
  it("strips a UTF-8 BOM", () => {
    expect(parseCsv("﻿a,b")).toEqual([["a", "b"]]);
  });
});

describe("findHeaderRow", () => {
  it("skips merged section-title rows and finds the header by token match", () => {
    const grid = [["Asset Inventory"], ["GENERAL"], ["Asset Description", "Owner & Location", "Classification"], ["Reputation", "HQ", "Highly Confidential"]];
    expect(findHeaderRow(grid, ["Asset Description", "Classification", "Value (Criticality)"])).toBe(2);
  });
  it("falls back to the first dense row when no tokens match", () => {
    const grid = [["title"], ["A", "B", "C"], ["1", "2", "3"]];
    expect(findHeaderRow(grid, [])).toBe(1);
  });
});

describe("parseWorkbook", () => {
  it("strips a single leading apostrophe (reversing the CSV formula guard) and drops blank rows", async () => {
    const csv = "Risk ID,Status\r\n'=cmd,Open\r\n,\r\nR-002,Closed";
    const { headers, rows } = await parseWorkbook(csv, "csv", ["Risk ID", "Status"]);
    expect(headers).toEqual(["Risk ID", "Status"]);
    expect(rows).toEqual([["=cmd", "Open"], ["R-002", "Closed"]]);
  });
  it("strips only one leading apostrophe when a cell has two, keeping the second", async () => {
    const csv = "Risk ID,Status\r\n''double,Open";
    const { rows } = await parseWorkbook(csv, "csv", ["Risk ID", "Status"]);
    expect(rows).toEqual([["'double", "Open"]]);
  });
  it("round-trips an XLSX produced by the export helper", async () => {
    type R = { a: string; b: number };
    const columns: ExportColumn<R>[] = [{ header: "Risk ID", value: (r) => r.a }, { header: "Likelihood", value: (r) => r.b }];
    const buffer = await toXlsx("Risk register", columns, [{ a: "R-001", b: 3 }]);
    const { headers, rows } = await parseWorkbook(buffer, "xlsx", ["Risk ID", "Likelihood"]);
    expect(headers).toEqual(["Risk ID", "Likelihood"]);
    expect(rows).toEqual([["R-001", "3"]]);
  });
});
