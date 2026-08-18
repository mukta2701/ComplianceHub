import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  requireContext: vi.fn(),
  protectExport: vi.fn(),
  recordExportAudit: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: hoisted.requireContext }));
vi.mock("@/features/exports/export-audit", () => ({ protectExport: hoisted.protectExport, recordExportAudit: hoisted.recordExportAudit }));

import { GET } from "./route";

function client() {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue({ data: { reference: "Q4/2026\\\"\r\n", title: "Quarterly audit" }, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
  };
  return { from: vi.fn(() => builder) };
}

describe("audit pack filenames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.protectExport.mockResolvedValue(undefined);
    hoisted.recordExportAudit.mockResolvedValue(undefined);
    hoisted.requireContext.mockResolvedValue({
      supabase: client(),
      organisation: { id: "11111111-1111-4111-8111-111111111111" },
      user: { id: "22222222-2222-4222-8222-222222222222" },
    });
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
