import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseCsv, findHeaderRow, parseWorkbook } from "./parse";
import { assertSafeXlsxArchive } from "./xlsx-archive";
import { toXlsx, type ExportColumn } from "@/features/exports/exports";

function renameZipEntry(buffer: Buffer, from: string, to: string): void {
  if (Buffer.byteLength(from) !== Buffer.byteLength(to)) throw new Error("ZIP entry replacement must preserve length");
  let offset = 0;
  let replacements = 0;
  while ((offset = buffer.indexOf(from, offset, "utf8")) !== -1) {
    buffer.write(to, offset, "utf8");
    offset += Buffer.byteLength(to);
    replacements += 1;
  }
  if (replacements < 2) throw new Error(`ZIP entry was not present in both headers: ${from}`);
}

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
  it("concatenates a rich-text cell's runs instead of stringifying the object", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Risk register");
    sheet.addRow(["Risk ID", "Risk Description"]);
    sheet.addRow(["R-001", { richText: [{ text: "Data " }, { text: "loss", font: { bold: true } }] }]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const { headers, rows } = await parseWorkbook(buffer, "xlsx", ["Risk ID", "Risk Description"]);
    expect(headers).toEqual(["Risk ID", "Risk Description"]);
    expect(rows).toEqual([["R-001", "Data loss"]]);
  });
  it("rejects a small XLSX whose archive expands beyond the safe limit", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Compressed payload");
    const repeated = "A".repeat(32_000);
    for (let row = 0; row < 350; row += 1) sheet.addRow([`${row}-${repeated}`]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    expect(buffer.byteLength).toBeLessThan(5_000_000);
    await expect(parseWorkbook(buffer, "xlsx")).rejects.toThrow("XLSX archive exceeds safe expansion limits.");
  });
  it("rejects a sparse XLSX whose populated cell has an unsafe row index", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sparse rows");
    sheet.getCell("A10001").value = "far away";
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(parseWorkbook(buffer, "xlsx")).rejects.toThrow("XLSX worksheet exceeds safe data limits.");
  });
  it("rejects a sparse XLSX whose populated cell has an unsafe column index", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sparse columns");
    sheet.getCell(1, 101).value = "far away";
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(parseWorkbook(buffer, "xlsx")).rejects.toThrow("XLSX worksheet exceeds safe data limits.");
  });
  it("rejects unsafe dimensions in a secondary worksheet", async () => {
    const workbook = new ExcelJS.Workbook();
    const safeSheet = workbook.addWorksheet("Import data");
    safeSheet.addRow(["Risk ID", "Status"]);
    safeSheet.addRow(["R-001", "Open"]);
    const unsafeSheet = workbook.addWorksheet("Hidden sparse data");
    unsafeSheet.getCell("A10001").value = "far away";
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(parseWorkbook(buffer, "xlsx", ["Risk ID", "Status"])).rejects.toThrow(
      "XLSX worksheet exceeds safe data limits.",
    );
  });
  it("rejects a workbook whose worksheets collectively exceed the populated-cell ceiling", async () => {
    const workbook = new ExcelJS.Workbook();
    const row = Array.from({ length: 90 }, (_, index) => String(index));
    for (let sheetIndex = 0; sheetIndex < 3; sheetIndex += 1) {
      const sheet = workbook.addWorksheet(`Data ${sheetIndex + 1}`);
      for (let rowIndex = 0; rowIndex < 100; rowIndex += 1) sheet.addRow(row);
    }
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(parseWorkbook(buffer, "xlsx")).rejects.toThrow("XLSX worksheet exceeds safe data limits.");
  });
  it("rejects excessive worksheet entries during archive preflight", async () => {
    const workbook = new ExcelJS.Workbook();
    for (let index = 0; index < 6; index += 1) {
      workbook.addWorksheet(`Data ${index + 1}`).addRow(["Risk ID", "Status"]);
    }
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(parseWorkbook(buffer, "xlsx")).rejects.toThrow("XLSX archive exceeds safe expansion limits.");
  });
  it("counts nonstandard direct worksheet XML entries during archive preflight", async () => {
    const workbook = new ExcelJS.Workbook();
    for (let index = 0; index < 6; index += 1) {
      workbook.addWorksheet(`Data ${index + 1}`).addRow(["Risk ID", "Status"]);
    }
    const craftedArchive = Buffer.from(await workbook.xlsx.writeBuffer());
    for (let index = 2; index <= 6; index += 1) {
      renameZipEntry(
        craftedArchive,
        `xl/worksheets/sheet${index}.xml`,
        `xl/worksheets/tab00${index}.xml`,
      );
    }

    await expect(assertSafeXlsxArchive(craftedArchive.buffer.slice(
      craftedArchive.byteOffset,
      craftedArchive.byteOffset + craftedArchive.byteLength,
    ) as ArrayBuffer)).rejects.toThrow("XLSX archive exceeds safe expansion limits.");
  });
  it("rejects an XLSX with too many populated cells", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Dense data");
    const row = Array.from({ length: 100 }, (_, index) => String(index));
    for (let index = 0; index < 251; index += 1) sheet.addRow(row);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(parseWorkbook(buffer, "xlsx")).rejects.toThrow("XLSX worksheet exceeds safe data limits.");
  });
  it("parses populated rows without materialising blank row gaps", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Normal sparse data");
    sheet.getRow(1).values = ["Risk ID", "Status"];
    sheet.getRow(10).values = ["R-001", "Open"];
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    await expect(parseWorkbook(buffer, "xlsx", ["Risk ID", "Status"])).resolves.toEqual({
      headers: ["Risk ID", "Status"],
      rows: [["R-001", "Open"]],
    });
  });
});
