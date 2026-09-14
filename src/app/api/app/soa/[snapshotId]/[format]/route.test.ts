import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  requireContext: vi.fn(),
  generateSoaPdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
  generateSoaDocx: vi.fn().mockResolvedValue(Buffer.from("docx")),
  protectExport: vi.fn(),
  recordExportAudit: vi.fn(),
  queries: [] as Array<{ column: string; value: unknown }>,
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: hoisted.requireContext }));
vi.mock("@/features/soa/application/export", () => ({ generateSoaPdf: hoisted.generateSoaPdf, generateSoaDocx: hoisted.generateSoaDocx }));
vi.mock("@/features/exports/export-audit", () => ({ protectExport: hoisted.protectExport, recordExportAudit: hoisted.recordExportAudit }));

import { GET } from "./route";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const SNAPSHOT_ID = "22222222-2222-4222-8222-222222222222";

function client(snapshot: Record<string, unknown> | null) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      hoisted.queries.push({ column, value });
      return builder;
    }),
    single: vi.fn().mockResolvedValue({ data: snapshot, error: null }),
  };
  return { from: vi.fn(() => builder) };
}

describe("finalised SoA export protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.queries.length = 0;
    hoisted.protectExport.mockResolvedValue(undefined);
    hoisted.recordExportAudit.mockResolvedValue(undefined);
  });

  it("rate-limits and audits a tenant-scoped PDF export", async () => {
    const snapshot = {
      id: SNAPSHOT_ID,
      title: "Statement of Applicability",
      version: 3,
      organisation_name: "Active organisation",
      finalised_at: "2026-08-18T00:00:00Z",
      finalised_by: "user-1",
      assessment_session_id: "33333333-3333-4333-8333-333333333333",
      items: [],
      catalogue_versions: null,
    };
    hoisted.requireContext.mockResolvedValue({
      supabase: client(snapshot),
      organisation: { id: ORG_ID },
      user: { id: "user-1" },
    });

    const response = await GET(new Request(`http://localhost/app/soa/${SNAPSHOT_ID}/pdf`), { params: Promise.resolve({ snapshotId: SNAPSHOT_ID, format: "pdf" }) });

    expect(response.status).toBe(200);
    expect(hoisted.queries).toEqual(expect.arrayContaining([
      { column: "id", value: SNAPSHOT_ID },
      { column: "organisation_id", value: ORG_ID },
    ]));
    expect(hoisted.protectExport).toHaveBeenCalledWith({ organisationId: ORG_ID, userId: "user-1", resource: "soa_snapshot", format: "pdf" });
    expect(hoisted.recordExportAudit).toHaveBeenCalledWith({ organisationId: ORG_ID, userId: "user-1", resource: "soa_snapshot", format: "pdf" });
  });

  it("does not export a snapshot missing from the active workspace", async () => {
    hoisted.requireContext.mockResolvedValue({ supabase: client(null), organisation: { id: ORG_ID }, user: { id: "user-1" } });

    const response = await GET(new Request(`http://localhost/app/soa/${SNAPSHOT_ID}/docx`), { params: Promise.resolve({ snapshotId: SNAPSHOT_ID, format: "docx" }) });

    expect(response.status).toBe(404);
    expect(hoisted.queries).toContainEqual({ column: "organisation_id", value: ORG_ID });
    expect(hoisted.recordExportAudit).not.toHaveBeenCalled();
  });
});
