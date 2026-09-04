import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ enabled: true, role: "owner", status: "draft", settingsError: false }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/app/actions", () => ({ finaliseSoaAction: vi.fn(), reviewSoaItemAction: vi.fn() }));
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  organisation: { id: "org" }, user: { id: "user" }, membership: { role: state.role },
  supabase: { from: (table: string) => {
    const rows: Record<string, Record<string, unknown>[]> = {
      assessment_sessions: [{ id: "session", organisation_id: "org", title: "Assessment", state: state.status, revision: 2, catalogue_version_id: "catalogue" }],
      catalogue_categories: [{ id: "category", catalogue_version_id: "catalogue", code: "GOV", title: "Governance", position: 0 }],
      catalogue_questions: [{ id: "question", catalogue_version_id: "catalogue", category_id: "category", code: "GOV-01", prompt: "Have leaders approved security objectives?", position: 0 }],
      assessment_responses: [{ session_id: "session", organisation_id: "org", question_id: "question", answer: "no", evidence_note: "" }],
      soa_registers: [{ id: "register", organisation_id: "org", title: "SoA", version: 1 }],
      soa_items: [{ id: "item", organisation_id: "org", soa_register_id: "register", control_id: "control", control_code: "A.5.1", control_title: "Security policies", applicable: true, status: "pending", justification: "", evidence: "", owner_id: null, position: 0 }],
      control_catalogue_controls: [{ id: "control", theme: "organisational" }],
      ai_workspace_settings: [{ organisation_id: "sibling", enabled: !state.enabled }, { organisation_id: "org", enabled: state.enabled }],
    };
    const filters: Array<[string, unknown]> = [];
    const data = () => (rows[table] ?? []).filter((row) => filters.every(([key, value]) => row[key] === value));
    const error = () => table === "ai_workspace_settings" && state.settingsError ? { message: "unavailable" } : null;
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "order", "in", "limit"]) chain[method] = () => chain;
    chain.eq = (column: string, value: unknown) => { filters.push([column, value]); return chain; };
    chain.single = chain.maybeSingle = () => Promise.resolve({ data: data()[0] ?? null, error: error() });
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: data(), error: error() }).then(resolve);
    return chain;
  } },
}) }));
import AssessmentPage from "./page";
import SoaPage from "../../soa/[id]/page";
beforeEach(() => { state.enabled = true; state.role = "owner"; state.status = "draft"; state.settingsError = false; });
describe.each([{ name: "assessment", page: AssessmentPage, id: "session" }, { name: "SoA", page: SoaPage, id: "register" }])("$name AI setting", ({ page, id }) => {
  it.each(["owner", "admin"])("exposes enabled drafting for %s", async (role) => {
    state.role = role;
    render(await page({ params: Promise.resolve({ id }) }));
    expect(screen.getByRole("button", { name: "Draft explanation and next step" })).toBeVisible();
  });
  it("uses the active workspace setting rather than a sibling setting", async () => {
    state.enabled = false;
    render(await page({ params: Promise.resolve({ id }) }));
    expect(screen.queryByRole("button", { name: "Draft explanation and next step" })).not.toBeInTheDocument();
  });
  it("keeps AI disabled when settings fail to load", async () => {
    state.settingsError = true;
    render(await page({ params: Promise.resolve({ id }) }));
    expect(screen.queryByRole("button", { name: "Draft explanation and next step" })).not.toBeInTheDocument();
  });
  it("keeps Member authoring unavailable despite enabled AI", async () => {
    state.role = "member";
    render(await page({ params: Promise.resolve({ id }) }));
    expect(screen.queryByRole("button", { name: "Draft explanation and next step" })).not.toBeInTheDocument();
  });
});
it("keeps completed assessment draft actions unavailable despite enabled AI", async () => {
  state.status = "completed";
  render(await AssessmentPage({ params: Promise.resolve({ id: "session" }) }));
  expect(screen.queryByRole("button", { name: /Review (task|risk) draft/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Draft explanation and next step" })).not.toBeInTheDocument();
});
