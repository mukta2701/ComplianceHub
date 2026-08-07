import ExcelJS from "exceljs";
import { assertSafeXlsxArchive } from "./xlsx-archive";
import {
  MAX_XLSX_COLUMNS,
  MAX_XLSX_POPULATED_CELLS,
  MAX_XLSX_ROW_INDEX,
  MAX_XLSX_WORKSHEETS,
} from "./limits";

export type ParsedWorkbook = { headers: string[]; rows: string[][] };

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_/()?:.\-]+/g, " ").trim();
const stripApostrophe = (cell: string) => (cell.startsWith("'") ? cell.slice(1) : cell);

export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQuotes = false, i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue; } inQuotes = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function parseXlsx(buf: ArrayBuffer): Promise<string[][]> {
  await assertSafeXlsxArchive(buf);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buf);
  if (workbook.worksheets.length > MAX_XLSX_WORKSHEETS) {
    throw new Error("XLSX worksheet exceeds safe data limits.");
  }
  let populatedCells = 0;
  for (const worksheet of workbook.worksheets) {
    if (worksheet.rowCount > MAX_XLSX_ROW_INDEX || worksheet.columnCount > MAX_XLSX_COLUMNS) {
      throw new Error("XLSX worksheet exceeds safe data limits.");
    }
    worksheet.eachRow((row) => {
      populatedCells += row.actualCellCount;
      if (populatedCells > MAX_XLSX_POPULATED_CELLS) {
        throw new Error("XLSX worksheet exceeds safe data limits.");
      }
    });
  }
  const sheet = workbook.worksheets[0];
  const grid: string[][] = [];
  if (!sheet) return grid;
  sheet.eachRow((excelRow) => {
    const values = excelRow.values as unknown[]; // 1-based; index 0 is undefined
    const cells: string[] = [];
    for (let c = 1; c < values.length; c++) {
      const v = values[c];
      if (v === null || v === undefined) cells.push("");
      else if (typeof v === "object" && "richText" in (v as Record<string, unknown>)) {
        const runs = (v as { richText: unknown }).richText;
        cells.push(Array.isArray(runs) ? runs.map((run) => String((run as { text?: unknown })?.text ?? "")).join("") : "");
      }
      else if (typeof v === "object" && "text" in (v as Record<string, unknown>)) cells.push(String((v as { text: unknown }).text));
      else if (typeof v === "object" && "result" in (v as Record<string, unknown>)) cells.push(String((v as { result: unknown }).result));
      else cells.push(String(v));
    }
    grid.push(cells);
  });
  return grid;
}

export function findHeaderRow(grid: readonly string[][], expected: readonly string[], minCells = 3): number {
  const wanted = expected.map(norm);
  let firstDense = -1;
  for (let i = 0; i < grid.length; i++) {
    const nonEmpty = grid[i].filter((c) => c.trim() !== "");
    if (firstDense === -1 && nonEmpty.length >= minCells) firstDense = i;
    if (wanted.length && grid[i].filter((c) => wanted.includes(norm(c))).length >= 2) return i;
  }
  return firstDense === -1 ? 0 : firstDense;
}

export async function parseWorkbook(
  input: string | ArrayBuffer | Uint8Array,
  format: "csv" | "xlsx",
  expectedHeaders: readonly string[] = [],
): Promise<ParsedWorkbook> {
  const grid = format === "csv"
    ? parseCsv(typeof input === "string" ? input : new TextDecoder().decode(input))
    : await parseXlsx(input instanceof Uint8Array
        ? (input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer)
        : (input as ArrayBuffer));
  const cleaned = grid.map((r) => r.map((c) => stripApostrophe(c).trim()));
  const headerIndex = findHeaderRow(cleaned, expectedHeaders);
  const headers = (cleaned[headerIndex] ?? []).filter((_, i, arr) => i < arr.length);
  const width = headers.length;
  const rows = cleaned.slice(headerIndex + 1).filter((r) => r.some((c) => c !== "")).map((r) => r.slice(0, width));
  return { headers, rows };
}
