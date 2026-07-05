import { describe, expect, it } from "vitest";
import { toCsv, toXlsx, type ExportColumn } from "./exports";

type Row = { a: string; b: number | null };
const columns: ExportColumn<Row>[] = [
  { header: "Alpha", value: (r) => r.a },
  { header: "Beta", value: (r) => r.b },
];

describe("toCsv", () => {
  it("emits a header row and escapes commas, quotes and newlines", () => {
    const csv = toCsv(columns, [{ a: 'x,"y"\nz', b: 3 }, { a: "plain", b: null }]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Alpha,Beta");
    expect(lines[1]).toBe('"x,""y""\nz",3');
    expect(lines[2]).toBe("plain,");
  });
});

describe("toXlsx", () => {
  it("produces a non-empty XLSX (zip) buffer", async () => {
    const buffer = await toXlsx("Sheet", columns, [{ a: "x", b: 1 }]);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK"); // zip signature
  });
});
