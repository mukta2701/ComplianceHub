import ExcelJS from "exceljs";

export type ExportColumn<T> = { header: string; value: (row: T) => string | number | null };

function cell(value: string | number | null): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv<T>(columns: ExportColumn<T>[], rows: readonly T[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(","));
  return lines.join("\r\n");
}

export async function toXlsx<T>(sheetName: string, columns: ExportColumn<T>[], rows: readonly T[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
  sheet.addRow(columns.map((c) => c.header));
  for (const row of rows) sheet.addRow(columns.map((c) => c.value(row) ?? ""));
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
