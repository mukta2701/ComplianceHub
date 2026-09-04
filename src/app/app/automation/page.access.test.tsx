import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "member" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  membership: { role: state.role }, user: { id: "reviewer" }, organisation: { id: "workspace" },
  supabase: { from: (table: string) => {
    const data = table === "automation_proposals" ? [{
      id: "proposal", target_type: "evidence", assigned_to: "reviewer", status: "draft",
      output: { title: "Review access evidence", why: "A source prepared this evidence" },
      created_at: "2026-09-04T00:00:00Z", source_references: [],
    }] : [];
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit"]) chain[method] = () => chain;
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
    return chain;
  } },
}) }));
import AutomationPage from "./page";

beforeEach(() => { state.role = "member"; });
describe("automation baseline permissions", () => {
  it.each(["member", "admin"])("hides owner-only baseline generation for %s without hiding assigned reviews", async (role) => {
    state.role = role;
    render(await AutomationPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole("button", { name: "Generate baseline" })).not.toBeInTheDocument();
    expect(screen.getByText("Review access evidence")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept as evidence" })).toBeInTheDocument();
  });
  it("preserves baseline generation for an Owner", async () => {
    state.role = "owner";
    render(await AutomationPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button", { name: "Generate baseline" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept as evidence" })).toBeInTheDocument();
  });
});


describe("automation task draft permissions", () => {
  it("keeps assigned Member evidence review but hides direct task creation", async () => {
    render(await AutomationPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button", { name: "Accept as evidence" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create task draft" })).not.toBeInTheDocument();
  });
  it.each(["owner", "admin"])("preserves assigned task drafting for %s", async (role) => {
    state.role = role;
    render(await AutomationPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button", { name: "Create task draft" })).toBeInTheDocument();
  });
});
