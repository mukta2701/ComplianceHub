import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "member", rows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/app-context", () => ({
  requireAppContext: async () => ({
    organisation: { id: "org-1" }, membership: { role: state.role },
    supabase: { from: () => {
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "limit"]) query[method] = () => query;
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: state.rows, count: state.rows.length, error: null }).then(resolve);
      return query;
    } },
  }),
}));
vi.mock("../actions", () => ({ createAssessmentAction: vi.fn(), createSoaAction: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/soa", redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
import AssessmentsPage from "./page";
import SoaPage from "../soa/page";
import SoaImportPage from "../soa/import/page";

beforeEach(() => { state.role = "member"; state.rows = []; });
afterEach(cleanup);

describe("assessment and SoA authoring access", () => {
  it("shows a readable empty assessment list without authoring actions to Members", async () => {
    render(await AssessmentsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByRole("button", { name: /assessment/i })).not.toBeInTheDocument();
    expect(screen.getByText(/No assessments are available yet/)).toBeVisible();
  });
  it("does not offer SoA imports or creation to Members with assessments", async () => {
    state.rows = [{ id: "record-1", title: "Readiness", version: 1 }];
    render(await SoaPage());
    expect(screen.queryByRole("button", { name: "Generate draft" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Import" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Readiness v1" })).toBeVisible();
  });
  it("redirects Members away from direct SoA import entry", async () => {
    await expect(SoaImportPage()).rejects.toThrow("redirect:/app/soa");
  });
  it.each(["owner", "admin"])("keeps assessment creation available for %s", async (role) => {
    state.role = role;
    render(await AssessmentsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("button", { name: "New assessment" })).toBeVisible();
  });
});
