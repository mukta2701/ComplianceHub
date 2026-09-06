import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "owner", rows: {} as Record<string, Record<string, unknown>[]>, failUpdate: false, emptyUpdate: false }));
const org = "10000000-0000-4000-8000-000000000001";
const otherOrg = "10000000-0000-4000-8000-000000000002";
const riskId = "20000000-0000-4000-8000-000000000001";
const otherRiskId = "20000000-0000-4000-8000-000000000002";
const categoryId = "30000000-0000-4000-8000-000000000001";
const ownerId = "40000000-0000-4000-8000-000000000001";
const foreignOwnerId = "40000000-0000-4000-8000-000000000002";
function query(table: string) {
  let single = false;
  let patch: Record<string, unknown> | null = null;
  const filters: ((row: Record<string, unknown>) => boolean)[] = [];
  const chain: Record<string, unknown> = {};
  chain.eq = (key: string, value: unknown) => { filters.push((row) => row[key] === value); return chain; };
  for (const name of ["select", "order", "limit", "in", "not"]) chain[name] = () => chain;
  chain.update = (value: Record<string, unknown>) => { patch = value; return chain; };
  for (const name of ["single", "maybeSingle"]) chain[name] = () => { single = true; return chain; };
  chain.then = (resolve: (value: unknown) => unknown) => {
    let rows = (state.rows[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
    if (patch && (state.failUpdate || state.emptyUpdate)) rows = [];
    if (patch) for (const row of rows) Object.assign(row, patch);
    return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: patch && state.failUpdate ? { code: "42501" } : null }).then(resolve);
  };
  return chain;
}
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  supabase: { from: query }, organisation: { id: org }, user: { id: ownerId }, membership: { role: state.role },
}) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
  usePathname: () => "/app/risks",
}));

import { updateRiskAction } from "./edit-actions";
import EditRiskPage from "./[id]/edit/page";
import NewRiskPage from "./new/page";
import RiskDetailPage from "./[id]/page";
import RisksPage from "./page";

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    id: riskId, reference: "R-001", title: "Reviewed supplier", description: "Updated exposure",
    categoryId, ownerId, likelihood: "4", impact: "4", residualLikelihood: "1", residualImpact: "2",
    treatment: "mitigate", treatmentPlan: "Review access", reviewDate: "2026-10-01", status: "treating", evidence: "E-1", ...overrides,
  })) data.set(key, value);
  return data;
}
beforeEach(() => {
  state.role = "owner"; state.failUpdate = false; state.emptyUpdate = false;
  const risk = { id: riskId, organisation_id: org, reference: "R-001", title: "Supplier risk", description: "Existing exposure", category_id: categoryId, owner_id: ownerId, likelihood: 3, impact: 4, residual_likelihood: 2, residual_impact: 3, treatment: "mitigate", treatment_plan: "Existing plan", status: "open", review_date: "2026-09-20", evidence: "Existing evidence", source_assessment_session_id: "original-assessment", source_soa_register_id: "original-soa", created_by: ownerId, created_at: "2026-09-01" };
  state.rows = {
    risks: [risk, { ...risk, id: otherRiskId, organisation_id: otherOrg, title: "Other company risk" }],
    risk_categories: [{ id: categoryId, organisation_id: org, name: "Suppliers" }],
    memberships: [{ user_id: ownerId, organisation_id: org, profiles: { display_name: "Ada Owner" } }, { user_id: foreignOwnerId, organisation_id: otherOrg, profiles: { display_name: "Foreign Owner" } }],
  };
});

describe("maintaining risks", () => {
  it.each(["owner", "admin"])("lets %s update editable fields without changing provenance or another workspace", async (role) => {
    state.role = role;
    await expect(updateRiskAction(form({ organisationId: otherOrg, sourceAssessmentSessionId: otherRiskId, sourceSoaRegisterId: otherRiskId, created_by: foreignOwnerId }))).rejects.toThrow(`REDIRECT:/app/risks/${riskId}`);
    expect(state.rows.risks[0]).toMatchObject({ title: "Reviewed supplier", owner_id: ownerId, residual_likelihood: 1, residual_impact: 2, review_date: "2026-10-01", organisation_id: org, source_assessment_session_id: "original-assessment", source_soa_register_id: "original-soa", created_by: ownerId, created_at: "2026-09-01" });
    expect(state.rows.risks[1].title).toBe("Other company risk");
  });
  it("permits clearing the owner and review date", async () => {
    await expect(updateRiskAction(form({ ownerId: "", reviewDate: "" }))).rejects.toThrow("REDIRECT:");
    expect(state.rows.risks[0]).toMatchObject({ owner_id: null, review_date: null });
  });
  it("rejects Member updates", async () => {
    state.role = "member";
    await expect(updateRiskAction(form())).rejects.toThrow("Only workspace operators");
    expect(state.rows.risks[0].title).toBe("Supplier risk");
  });
  it("rejects another workspace's risk even if the user could read it", async () => {
    await expect(updateRiskAction(form({ id: otherRiskId }))).rejects.toThrow("active workspace");
    expect(state.rows.risks[1].title).toBe("Other company risk");
  });
  it.each<Record<string, string>>([{ ownerId: foreignOwnerId }, { categoryId: otherRiskId }, { residualLikelihood: "6" }])("rejects invalid ownership, categories or scores (%j)", async (overrides) => {
    await expect(updateRiskAction(form(overrides))).rejects.toThrow();
    expect(state.rows.risks[0].title).toBe("Supplier risk");
  });
  it.each(["failUpdate", "emptyUpdate"] as const)("does not report success when update produces %s", async (flag) => {
    state[flag] = true;
    await expect(updateRiskAction(form())).rejects.toThrow(/Could not update|not found/);
    expect(state.rows.risks[0].title).toBe("Supplier risk");
  });
  it("loads the current values and workspace owners in the edit form", async () => {
    render(await EditRiskPage({ params: Promise.resolve({ id: riskId }) }));
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Supplier risk");
    expect(screen.getByRole("combobox", { name: "Owner" })).toHaveValue(ownerId);
    expect(screen.getByRole("combobox", { name: "Residual likelihood" })).toHaveValue("2");
    expect(screen.queryByRole("option", { name: "Foreign Owner" })).not.toBeInTheDocument();
  });
  it("offers workspace ownership when creating a risk", async () => {
    render(await NewRiskPage({ searchParams: Promise.resolve({ title: "Suggested risk" }) }));
    expect(screen.getByRole("combobox", { name: "Owner" })).toHaveValue("");
    expect(screen.getByRole("option", { name: "Ada Owner" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Foreign Owner" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Suggested risk");
  });
  it("redirects Member edit entry and rejects sibling-workspace edit entry", async () => {
    state.role = "member";
    await expect(EditRiskPage({ params: Promise.resolve({ id: riskId }) })).rejects.toThrow(`REDIRECT:/app/risks/${riskId}`);
    state.role = "owner";
    await expect(EditRiskPage({ params: Promise.resolve({ id: otherRiskId }) })).rejects.toThrow("NOT_FOUND");
  });
  it.each(["owner", "admin"])("offers %s the risk edit link", async (role) => {
    state.role = role;
    render(await RiskDetailPage({ params: Promise.resolve({ id: riskId }) }));
    expect(screen.getByRole("link", { name: "Edit risk" })).toHaveAttribute("href", `/app/risks/${riskId}/edit`);
  });
  it("counts only open exposure in the risk heatmap", async () => {
    state.rows.risks.push({ ...state.rows.risks[0], id: "closed", status: "closed" });
    render(await RisksPage());
    expect(screen.getByText(/Remaining exposure for/)).toHaveTextContent("1 open risk, scored by likelihood");
  });
  it("lets Members read ownership, treatment instructions and evidence references", async () => {
    state.role = "member";
    state.rows.risk_treatment_plans = [{ id: "plan-1", risk_id: riskId, organisation_id: org, reference: "RTP-001", summary: "Access review", treatment_measures: "Verify every privileged account", status: "planned", assigned_lead_id: ownerId }];
    render(await RiskDetailPage({ params: Promise.resolve({ id: riskId }) }));
    expect(screen.getByText("Ada Owner", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Existing plan")).toBeInTheDocument();
    expect(screen.getByText("Existing evidence")).toBeInTheDocument();
    expect(screen.getByText("Verify every privileged account")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit risk" })).not.toBeInTheDocument();
  });
});
