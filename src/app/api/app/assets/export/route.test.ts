import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  requireContext: vi.fn(), protectExport: vi.fn(), recordExportAudit: vi.fn(),
  failAfterId: null as string | null,
}));
vi.mock("@/lib/app-context", () => ({ requireAppContext: state.requireContext }));
vi.mock("@/features/exports/export-audit", () => ({ protectExport: state.protectExport, recordExportAudit: state.recordExportAudit }));
import { GET } from "./route";

const organisationId = "active-workspace";
const userId = "exporting-operator";
const headers = ["Asset Reference", "Asset Description", "Category", "Owner & Location", "Classification", "Value (Criticality)", "Security Controls", "Asset Lifespan", "Last Updated", "Remarks"];

function asset(index: number, workspace = organisationId) {
  return {
    id: String(index).padStart(6, "0"), organisation_id: workspace,
    reference: `AST-${String(1206 - index).padStart(4, "0")}`,
    description: `Fictional asset ${index}`, owner_location: "London", classification: "confidential",
    value_criticality: "high", security_controls: "Access review", lifespan: "3 years",
    last_updated: "2026-09-10", remarks: "Fictional inventory", asset_categories: { name: "Technology" },
  };
}
type Asset = ReturnType<typeof asset>;

function client(rows: Asset[]) {
  return { from: vi.fn(() => {
    const equals: Array<[string, unknown]> = [];
    let afterId: string | null = null;
    let limit = 1000;
    let order = "reference";
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => { equals.push([column, value]); return builder; }),
      gt: vi.fn((_column: string, value: string) => { afterId = value; return builder; }),
      order: vi.fn((column: string) => { order = column; return builder; }),
      limit: vi.fn((value: number) => { limit = value; return builder; }),
      then: (resolve: (result: unknown) => unknown) => {
        if (afterId && state.failAfterId === afterId) return Promise.resolve({ data: null, error: { message: "private database detail" } }).then(resolve);
        const data = rows.filter((row) => equals.every(([column, value]) => row[column as keyof Asset] === value) && (!afterId || row.id > afterId))
          .sort((a, b) => String(a[order as keyof Asset]).localeCompare(String(b[order as keyof Asset])))
          .slice(0, Math.min(limit, 1000));
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return builder;
  }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.failAfterId = null;
  state.protectExport.mockResolvedValue(undefined);
  state.recordExportAudit.mockResolvedValue(undefined);
  state.requireContext.mockResolvedValue({
    supabase: client([...Array.from({ length: 1205 }, (_, index) => asset(index + 1)), { ...asset(1206, "sibling-workspace"), description: "Sibling-only asset" }]),
    organisation: { id: organisationId }, user: { id: userId },
  });
});

describe("complete asset exports", () => {
  it("exports every workspace asset in reference order beyond the database row cap", async () => {
    const response = await GET(new Request("http://localhost/api/app/assets/export?format=csv"));
    const csv = await response.text();
    const lines = csv.split("\r\n");
    expect(response.status).toBe(200);
    expect(lines).toHaveLength(1206);
    expect(lines[0]).toBe(headers.join(","));
    expect(lines[1]).toContain("AST-0001,Fictional asset 1205,Technology,London,Confidential,High");
    expect(lines[1205]).toContain("AST-1205,Fictional asset 1");
    expect(csv).not.toContain("Sibling-only asset");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(state.protectExport).toHaveBeenCalledWith({ organisationId, userId, resource: "assets", format: "csv" });
    expect(state.recordExportAudit).toHaveBeenCalledTimes(1);
  });

  it.each(["csv", "xlsx"])("refuses a partial %s export when a later page fails", async (format) => {
    state.failAfterId = "000500";
    const response = await GET(new Request(`http://localhost/api/app/assets/export?format=${format}`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Could not export assets" });
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(state.recordExportAudit).not.toHaveBeenCalled();
  });

  it("writes the complete XLSX workbook with the existing columns", async () => {
    const response = await GET(new Request("http://localhost/api/app/assets/export?format=xlsx"));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await response.arrayBuffer());
    const sheet = workbook.getWorksheet("Asset inventory")!;
    expect(response.status).toBe(200);
    expect(sheet.rowCount).toBe(1206);
    expect(sheet.getRow(1).values).toEqual([undefined, ...headers]);
    expect(sheet.getCell("A2").value).toBe("AST-0001");
    expect(sheet.getCell("B2").value).toBe("Fictional asset 1205");
    expect(sheet.getCell("A1206").value).toBe("AST-1205");
    expect(response.headers.get("content-disposition")).toContain("asset-inventory.xlsx");
    expect(state.recordExportAudit).toHaveBeenCalledWith({ organisationId, userId, resource: "assets", format: "xlsx" });
  });

  it("does not read or audit assets when export protection denies the request", async () => {
    const supabase = client([asset(1)]);
    state.requireContext.mockResolvedValue({ supabase, organisation: { id: organisationId }, user: { id: userId } });
    state.protectExport.mockRejectedValue(new Error("Export rate limit reached"));
    await expect(GET(new Request("http://localhost/api/app/assets/export?format=csv"))).rejects.toThrow("Export rate limit reached");
    expect(supabase.from).not.toHaveBeenCalled();
    expect(state.recordExportAudit).not.toHaveBeenCalled();
  });
});
