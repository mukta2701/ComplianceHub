import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  role: "member" as "owner" | "admin" | "member",
  snapshot: null as null | Record<string, unknown>,
  loadReadinessInput: vi.fn().mockResolvedValue({}),
  from: vi.fn(),
  liveReport: { soaTotal: 0 } as Record<string, unknown>,
}));

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    supabase: { from: hoisted.from },
    organisation: { id: "org-1", name: "Example Ltd" },
    membership: { role: hoisted.role },
  }),
}));
vi.mock("@/features/reports/application/load-readiness", () => ({
  loadReadinessInput: hoisted.loadReadinessInput,
}));
vi.mock("@/features/reports/domain/readiness-report", () => ({
  buildReadinessReport: () => hoisted.liveReport,
}));

import ReadinessReportPage from "./page";

describe("leadership report empty state", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.snapshot = null;
    hoisted.liveReport = { soaTotal: 0 };
    const result = () => Promise.resolve({ data: hoisted.snapshot, error: null });
    const chain = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn(result) };
    chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain); chain.order.mockReturnValue(chain); chain.limit.mockReturnValue(chain);
    hoisted.from.mockReturnValue(chain);
  });

  it("gives Members a read-only unavailable state", async () => {
    hoisted.role = "member";
    render(await ReadinessReportPage());

    expect(screen.getByRole("heading", { name: "Leadership report not available yet" })).toBeInTheDocument();
    expect(screen.getByText("No leadership report is available for members yet. A workspace operator can publish readiness information when it is ready.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Start assessment" })).not.toBeInTheDocument();
    expect(hoisted.from).toHaveBeenCalledWith("leadership_report_snapshots");
    expect(hoisted.loadReadinessInput).not.toHaveBeenCalled();
  });

  it("renders the latest immutable snapshot for Members instead of live operational data", async () => {
    hoisted.role = "member";
    hoisted.snapshot = {
      id: "7e000000-0000-4000-8000-000000000001", organisation_name: "Example Ltd", published_at: "2026-07-14T07:30:00Z",
      publisher: { display_name: "Morgan Owner" },
      payload: { soaPercent: 75, soaTotal: 20, riskBands: { low: 2, moderate: 1, high: 0, very_high: 0 }, tasksOpen: 3, tasksOverdue: 1, evidence: { total: 5, expiring: 1, expired: 0 }, openAudits: 1, openNonConformities: 0 },
    };

    render(await ReadinessReportPage());

    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText(/Published by Morgan Owner/i)).toBeInTheDocument();
    expect(hoisted.loadReadinessInput).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /publish/i })).not.toBeInTheDocument();
  });

  it("keeps the assessment action for operators", async () => {
    hoisted.role = "admin";
    render(await ReadinessReportPage());

    expect(screen.getByRole("heading", { name: "Run an assessment first" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start assessment" })).toHaveAttribute("href", "/app/assessment");
    expect(hoisted.loadReadinessInput).toHaveBeenCalled();
  });

  it("lets operators publish a live report for members", async () => {
    hoisted.role = "owner";
    hoisted.liveReport = {
      soaTotal: 20, soaPercent: 75, riskBands: { low: 2, moderate: 1, high: 0, very_high: 0 }, tasksOpen: 3, tasksOverdue: 1,
      evidence: { total: 5, expiring: 1, expired: 0 }, openAudits: 1, openNonConformities: 0,
    };

    render(await ReadinessReportPage());

    expect(screen.getByRole("button", { name: "Publish to members" })).toBeInTheDocument();
  });
});
