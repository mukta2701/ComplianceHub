import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ role: "member", error: false, from: vi.fn() }));
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({ supabase: { from: fixture.from }, organisation: { id: "workspace", name: "Example" }, membership: { role: fixture.role } }) }));
vi.mock("./baseline-form", () => ({ BaselineForm: () => <form aria-label="Edit baseline" /> }));
import BaselinePage from "./page";
const payload = { schemaVersion:1,calculationVersion:1,organisationId:"workspace",organisationName:"Example",objective:"Saved leadership goal",savedAt:"2026-09-09T12:00:00Z",progressRevision:1,scope:null,assessment:null,questions:[],tasks:[],contributions:[],evidence:[],risks:[],riskConfig:null };
beforeEach(() => {
  fixture.role = "member"; fixture.error = false;
  fixture.from.mockReset().mockImplementation((table: string) => {
    let columns=""; let predecessor=false;
    const query = {
      select: (value: string) => { columns=value; return query; }, eq: () => query,
      lt: () => { predecessor=true; return query; }, order: () => query, limit: () => query,
      maybeSingle: () => Promise.resolve({ data: table === "baseline_snapshots" && !predecessor ? { id:"98000000-0000-4000-8000-000000000101",payload,progress_revision:1 } : null,error:fixture.error }),
      then: (resolve: (result: unknown) => unknown) => resolve({ data: columns.includes("saved_at") ? [{ id:"98000000-0000-4000-8000-000000000101",saved_at:payload.savedAt,progress_revision:1 }] : [], error:fixture.error }),
    }; return query;
  });
});
describe("baseline route", () => {
  it("gives Members saved explanations and history without querying operator progress", async () => {
    render(await BaselinePage({searchParams:Promise.resolve({})}));
    expect(screen.getByText("Saved leadership goal")).toBeInTheDocument();
    expect(screen.getByRole("link",{name:/Baseline saved/})).toHaveAttribute("href","/app/baseline?snapshot=98000000-0000-4000-8000-000000000101");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(fixture.from.mock.calls.map(([table])=>table)).not.toContain("baseline_progress");
    expect(fixture.from.mock.calls.map(([table])=>table)).not.toContain("assessment_sessions");
  });
  it("reports query errors instead of implying no baseline exists", async () => {
    fixture.error=true;
    await expect(BaselinePage({searchParams:Promise.resolve({})})).rejects.toThrow("Could not load");
  });
  it("rejects malformed history ids without querying data", async () => {
    render(await BaselinePage({searchParams:Promise.resolve({snapshot:"not-an-id"})}));
    expect(screen.getByText(/reference is invalid/)).toBeInTheDocument(); expect(fixture.from).not.toHaveBeenCalled();
  });
});
