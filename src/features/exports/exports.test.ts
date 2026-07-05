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

  it("neutralises leading formula characters to prevent CSV/spreadsheet injection", () => {
    const csv = toCsv(columns, [
      { a: "=SUM(A1)", b: null },
      { a: "@cmd|'/c calc'!A0", b: null },
      { a: "-5", b: null },
    ]);
    const lines = csv.split("\r\n");
    // A leading '=' is neutralised with a leading apostrophe so Excel/Sheets
    // read it as text rather than executing it as a formula.
    expect(lines[1]).toBe("'=SUM(A1),");
    // Same for a leading '@'.
    expect(lines[2]).toBe("'@cmd|'/c calc'!A0,");
    // A first-char rule also catches values that merely look like a negative
    // number (e.g. "-5"); that's an accepted, safe over-neutralisation since
    // "-5" is otherwise indistinguishable from a formula-injection payload
    // such as "-2+3+cmd|...".
    expect(lines[3]).toBe("'-5,");
  });

  it("leaves ordinary values, including ones with an internal (non-leading) formula character, untouched", () => {
    const csv = toCsv(columns, [
      { a: "hello", b: null },
      { a: "total=5", b: null },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe("hello,");
    expect(lines[2]).toBe("total=5,");
  });
});

describe("toXlsx", () => {
  it("produces a non-empty XLSX (zip) buffer", async () => {
    const buffer = await toXlsx("Sheet", columns, [{ a: "x", b: 1 }]);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK"); // zip signature
  });
});
