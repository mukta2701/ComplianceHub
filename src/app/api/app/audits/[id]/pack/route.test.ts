import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  requireContext: vi.fn(),
  protectExport: vi.fn(),
  recordExportAudit: vi.fn(),
  linksError: false,
  evidenceStatus: "current",
  evidenceValidUntil: "2027-09-05",
  filters: [] as Array<[string, string, unknown]>,
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: hoisted.requireContext }));
vi.mock("@/features/exports/export-audit", () => ({ protectExport: hoisted.protectExport, recordExportAudit: hoisted.recordExportAudit }));

import { GET } from "./route";

function client() {
  function query(table: string) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column, value) => { hoisted.filters.push([table, column, value]); return builder; }),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder), gt: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue({ data: { reference: "Q4/2026\\\"\r\n", title: "Quarterly audit" }, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "evidence_links" ? [{ id: "link-1", evidence_id: "proof-1", audit_checklist_item_id: "check-1", audit_checklist_items: { audit_id: "audit-1", checklist_item: "Review sign-off" }, evidence: { id: "proof-1", title: "Fictional fresh verification", description: "Reviewed the corrected fictional sample", kind: "note", status: hoisted.evidenceStatus, collected_on: "2026-09-05", valid_until: hoisted.evidenceValidUntil } }] : [], error: table === "evidence_links" && hoisted.linksError ? { message: "private detail" } : null }).then(resolve),
  };
  return builder;
  }
  return { from: vi.fn(query) };
}

describe("audit pack filenames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.linksError = false; hoisted.filters = [];
    hoisted.evidenceStatus = "current";
    hoisted.evidenceValidUntil = "2027-09-05";
    hoisted.protectExport.mockResolvedValue(undefined);
    hoisted.recordExportAudit.mockResolvedValue(undefined);
    hoisted.requireContext.mockResolvedValue({
      supabase: client(),
      organisation: { id: "11111111-1111-4111-8111-111111111111" },
      user: { id: "22222222-2222-4222-8222-222222222222" },
    });
  });

  it("exports the selected audit's linked evidence contents, dates and stable identity", async () => {
    const response = await GET(new Request("http://localhost/api/app/audits/audit-1/pack?format=csv"), { params: Promise.resolve({ id: "audit-1" }) });
    const csv = await response.text();
    expect(csv).toContain("Fictional fresh verification");
    expect(csv).toContain("Review sign-off");
    expect(csv).toContain("proof-1");
    expect(csv).toContain("2026-09-05");
    expect(csv).toContain("2027-09-05");
    expect(csv).toContain("Reviewed the corrected fictional sample");
    expect(hoisted.filters).toContainEqual(["evidence_links", "audit_checklist_items.audit_id", "audit-1"]);
    expect(hoisted.filters).toContainEqual(["evidence_links", "organisation_id", "11111111-1111-4111-8111-111111111111"]);
  });

  it("refuses an apparently complete export when linked evidence cannot be loaded", async () => {
    hoisted.linksError = true;
    const response = await GET(new Request("http://localhost/api/app/audits/audit-1/pack?format=csv"), { params: Promise.resolve({ id: "audit-1" }) });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private detail");
    expect(hoisted.recordExportAudit).not.toHaveBeenCalled();
  });

  it("exports effective freshness when a stored-current record has passed its validity date", async () => {
    hoisted.evidenceValidUntil = "2026-09-01";
    const response = await GET(new Request("http://localhost/api/app/audits/audit-1/pack?format=csv"), { params: Promise.resolve({ id: "audit-1" }) });
    const csv = await response.text();
    expect(csv).toContain("Fictional fresh verification,expired");
  });

  it("keeps fallback filenames path/control-character safe while preserving encoded names", async () => {
    const response = await GET(new Request("http://localhost/api/app/audits/audit-1/pack?format=csv"), { params: Promise.resolve({ id: "audit-1" }) });
    const disposition = response.headers.get("content-disposition") ?? "";

    expect(response.status).toBe(200);
    expect(disposition).toContain('filename="audit-pack-Q42026.csv"');
    expect(disposition).toContain("filename*=UTF-8''audit-pack-Q4%2F2026%5C%22%0D%0A.csv");
    expect(disposition).not.toMatch(/[\r\n]/);
  });
});
