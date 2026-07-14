import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ role: "member" as "owner" | "admin" | "member" }));

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    supabase: {},
    organisation: { id: "org-1", name: "Example Ltd" },
    membership: { role: hoisted.role },
  }),
}));
vi.mock("@/features/reports/application/load-readiness", () => ({
  loadReadinessInput: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/features/reports/domain/readiness-report", () => ({
  buildReadinessReport: () => ({ soaTotal: 0 }),
}));

import ReadinessReportPage from "./page";

describe("leadership report empty state", () => {
  afterEach(cleanup);

  it("gives Members a read-only unavailable state", async () => {
    hoisted.role = "member";
    render(await ReadinessReportPage());

    expect(screen.getByRole("heading", { name: "Leadership report not available yet" })).toBeInTheDocument();
    expect(screen.getByText("No leadership report is available for members yet. A workspace operator can publish readiness information when it is ready.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Start assessment" })).not.toBeInTheDocument();
  });

  it("keeps the assessment action for operators", async () => {
    hoisted.role = "admin";
    render(await ReadinessReportPage());

    expect(screen.getByRole("heading", { name: "Run an assessment first" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start assessment" })).toHaveAttribute("href", "/app/assessment");
  });
});
