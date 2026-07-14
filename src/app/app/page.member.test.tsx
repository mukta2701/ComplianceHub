import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  loadMemberOverview: vi.fn(),
  from: vi.fn(() => { throw new Error("Operator dashboard query reached a Member request"); }),
}));

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    supabase: { from: hoisted.from },
    user: { id: "member-1" },
    membership: { role: "member", job_title: "Developer" },
    organisation: { id: "org-1", name: "Example Ltd" },
  }),
}));
vi.mock("@/features/dashboard/application/load-member-overview", () => ({
  loadMemberOverview: hoisted.loadMemberOverview,
}));
vi.mock("./tasks/actions", () => ({ acceptCalendarSeedAction: vi.fn() }));

import AppHome from "./page";

describe("Member app home branch", () => {
  it("returns the Member overview before loading the operational dashboard", async () => {
    hoisted.loadMemberOverview.mockResolvedValue({
      organisationName: "Example Ltd",
      jobTitle: "Developer",
      policies: { approved: 1, acceptedCurrent: 1 },
      connectedSystems: [],
      findings: { active: 0, highOrCritical: 0 },
    });

    render(await AppHome());

    expect(screen.getByRole("heading", { name: "Welcome to Example Ltd" })).toBeInTheDocument();
    expect(hoisted.loadMemberOverview).toHaveBeenCalledOnce();
    expect(hoisted.from).not.toHaveBeenCalled();
  });
});
