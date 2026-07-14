import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  loadMemberMonitoring: vi.fn(),
  from: vi.fn(() => { throw new Error("Operator monitoring query reached a Member request"); }),
}));

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    supabase: { from: hoisted.from },
    organisation: { id: "org-1", name: "Example Ltd" },
    membership: { role: "member" },
  }),
}));
vi.mock("@/features/monitoring/application/load-member-monitoring", () => ({
  loadMemberMonitoring: hoisted.loadMemberMonitoring,
}));
vi.mock("@/features/monitoring/application/monitor-registry", () => ({
  resolveMonitorProvider: vi.fn(() => { throw new Error("Provider config loaded for Member"); }),
}));

import MonitoringPage from "./page";

describe("Member monitoring page branch", () => {
  it("returns the Member-safe view before loading source config or alert channels", async () => {
    hoisted.loadMemberMonitoring.mockResolvedValue({ connectedSystems: [], findings: [] });

    render(await MonitoringPage());

    expect(screen.getByRole("heading", { name: "Continuous monitoring" })).toBeInTheDocument();
    expect(hoisted.loadMemberMonitoring).toHaveBeenCalledWith(expect.anything(), "org-1");
    expect(hoisted.from).not.toHaveBeenCalled();
  });
});
