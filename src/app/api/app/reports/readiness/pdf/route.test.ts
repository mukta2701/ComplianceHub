import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  role: "member" as "owner" | "admin" | "member",
  snapshot: null as null | Record<string, unknown>,
  loadReadinessInput: vi.fn().mockResolvedValue({}),
  generateReadinessPdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
  from: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    supabase: { from: hoisted.from },
    organisation: { id: "org-1", name: "Live organisation name" },
    membership: { role: hoisted.role },
  }),
}));
vi.mock("@/features/reports/application/load-readiness", () => ({ loadReadinessInput: hoisted.loadReadinessInput }));
vi.mock("@/features/reports/domain/readiness-report", () => ({ buildReadinessReport: vi.fn(() => ({ soaTotal: 99 })) }));
vi.mock("@/features/reports/application/readiness-pdf", () => ({ generateReadinessPdf: hoisted.generateReadinessPdf }));

import { GET } from "./route";

describe("readiness PDF role source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.snapshot = null;
    const result = () => Promise.resolve({ data: hoisted.snapshot, error: null });
    const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(result) };
    chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain); chain.order.mockReturnValue(chain); chain.limit.mockReturnValue(chain);
    hoisted.from.mockReturnValue(chain);
  });

  it("renders a Member PDF from the latest immutable snapshot", async () => {
    hoisted.role = "member";
    const payload = { soaTotal: 20, soaPercent: 75, riskBands: { low: 2, moderate: 1, high: 0, very_high: 0 }, tasksOpen: 3, tasksOverdue: 1, evidence: { total: 5, expiring: 1, expired: 0 }, openAudits: 1, openNonConformities: 0 };
    hoisted.snapshot = {
      id: "7e000000-0000-4000-8000-000000000002", payload, organisation_name: "Published organisation name",
      published_at: "2026-07-14T07:30:00Z", publisher: { display_name: "Morgan Owner" },
    };

    const response = await GET();

    expect(response.status).toBe(200);
    expect(hoisted.loadReadinessInput).not.toHaveBeenCalled();
    expect(hoisted.generateReadinessPdf).toHaveBeenCalledWith(payload, "Published organisation name");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns a private 404 when no Member snapshot has been published", async () => {
    hoisted.role = "member";

    const response = await GET();

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(hoisted.generateReadinessPdf).not.toHaveBeenCalled();
  });

  it("keeps live report generation for operators", async () => {
    hoisted.role = "admin";

    const response = await GET();

    expect(response.status).toBe(200);
    expect(hoisted.loadReadinessInput).toHaveBeenCalledWith(expect.anything(), "org-1");
    expect(hoisted.generateReadinessPdf).toHaveBeenCalledWith({ soaTotal: 99 }, "Live organisation name");
  });
});
