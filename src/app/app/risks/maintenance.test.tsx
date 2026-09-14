import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "owner", rows: {} as Record<string, Record<string, unknown>[]>, failUpdate: false, emptyUpdate: false, failAssets: false, failTables: new Set<string>() }));
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
  let range: [number, number] | null = null;
  const filters: ((row: Record<string, unknown>) => boolean)[] = [];
  const chain: Record<string, unknown> = {};
  chain.eq = (key: string, value: unknown) => { filters.push((row) => row[key] === value); return chain; };
  for (const name of ["select", "order", "limit", "in", "not"]) chain[name] = () => chain;
  chain.range = (from: number, to: number) => { range = [from, to]; return chain; };
  chain.update = (value: Record<string, unknown>) => { patch = value; return chain; };
  for (const name of ["single", "maybeSingle"]) chain[name] = () => { single = true; return chain; };
  chain.then = (resolve: (value: unknown) => unknown) => {
    if (state.failTables.has(table)) return Promise.resolve({ data: null, error: { code: "08006" } }).then(resolve);
    if (table === "asset_risks" && state.failAssets) return Promise.resolve({ data: null, error: { code: "08006" } }).then(resolve);
    let rows = (state.rows[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
    if (range) rows = rows.slice(range[0], range[1] + 1);
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

import { createRiskFormAction, updateRiskAction, updateRiskFormAction } from "./edit-actions";
import EditRiskPage from "./[id]/edit/page";
import NewRiskPage from "./new/page";
import RiskDetailPage from "./[id]/page";
import RisksPage from "./page";

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    id: riskId, expectedUpdatedAt: "2026-09-10T01:00:00.000Z", reference: "R-001", title: "Reviewed supplier", description: "Updated exposure",
    categoryId, ownerId, likelihood: "4", impact: "4", residualLikelihood: "1", residualImpact: "2",
    treatment: "mitigate", treatmentPlan: "Review access", reviewDate: "2026-10-01", status: "treating", evidence: "E-1", ...overrides,
  })) data.set(key, value);
  return data;
}
beforeEach(() => {
  state.role = "owner"; state.failUpdate = false; state.emptyUpdate = false; state.failAssets = false; state.failTables.clear();
  const risk = { id: riskId, organisation_id: org, reference: "R-001", title: "Supplier risk", description: "Existing exposure", category_id: categoryId, owner_id: ownerId, likelihood: 3, impact: 4, residual_likelihood: 2, residual_impact: 3, treatment: "mitigate", treatment_plan: "Existing plan", status: "open", review_date: "2026-09-20", evidence: "Existing evidence", source_assessment_session_id: "original-assessment", source_soa_register_id: "original-soa", created_by: ownerId, created_at: "2026-09-01", updated_at: "2026-09-10T01:00:00.000Z" };
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
  it("returns field errors without discarding a create draft", async () => {
    const result = await createRiskFormAction({}, form({ title: "   " }));
    expect(result.error).toBe("Check the highlighted fields and try again.");
    expect(result.fieldErrors?.title).toBeTruthy();
  });
  it("returns a recoverable conflict for an old edit version", async () => {
    state.rows.risks[0].updated_at = "2026-09-10T02:00:00.000Z";
    const result = await updateRiskFormAction({}, form());
    expect(result).toEqual({ error: "This risk changed or is no longer available. Reload it before saving again.", conflict: true });
    expect(state.rows.risks[0].title).toBe("Supplier risk");
  });
  it.each(["failUpdate", "emptyUpdate"] as const)("does not report success when update produces %s", async (flag) => {
    state[flag] = true;
    await expect(updateRiskAction(form())).rejects.toThrow(/Could not update|changed or is no longer available/);
    expect(state.rows.risks[0].title).toBe("Supplier risk");
  });
  it("loads the current values and workspace owners in the edit form", async () => {
    render(await EditRiskPage({ params: Promise.resolve({ id: riskId }) }));
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Supplier risk");
    expect(screen.getByRole("combobox", { name: "Owner" })).toHaveValue(ownerId);
    expect(screen.getByRole("combobox", { name: "Residual likelihood" })).toHaveValue("2");
    expect(document.querySelector('input[name="expectedUpdatedAt"]')).toHaveValue("2026-09-10T01:00:00.000Z");
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
  it("shows assets already linked to this risk without exposing sibling workspace links", async () => {
    state.rows.asset_risks = [
      { risk_id: riskId, organisation_id: org, asset_id: "asset-1", assets: { id: "asset-1", reference: "A-001", description: "Customer database" } },
      { risk_id: riskId, organisation_id: otherOrg, asset_id: "foreign-asset", assets: { id: "foreign-asset", reference: "A-999", description: "Foreign database" } },
      { risk_id: otherRiskId, organisation_id: org, asset_id: "unrelated-asset", assets: { id: "unrelated-asset", reference: "A-002", description: "Other risk asset" } },
    ];
    render(await RiskDetailPage({ params: Promise.resolve({ id: riskId }) }));
    expect(screen.getByRole("link", { name: "A-001: Customer database" })).toHaveAttribute("href", "/app/assets/asset-1");
    expect(screen.queryByText(/Foreign database|Other risk asset/)).not.toBeInTheDocument();
  });
  it("does not describe failed asset loading as an empty register", async () => {
    state.failAssets = true;
    render(await RiskDetailPage({ params: Promise.resolve({ id: riskId }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("Linked assets could not be loaded. Reload this page to try again.");
    expect(screen.queryByText("No assets linked to this risk yet.")).not.toBeInTheDocument();
  });
  it("distinguishes no links from an unavailable linked asset", async () => {
    const page = render(await RiskDetailPage({ params: Promise.resolve({ id: riskId }) }));
    expect(screen.getByText("No assets linked to this risk yet.")).toBeInTheDocument();
    page.unmount();
    state.rows.asset_risks = [{ risk_id: riskId, organisation_id: org, asset_id: "unavailable", assets: null }];
    render(await RiskDetailPage({ params: Promise.resolve({ id: riskId }) }));
    expect(screen.getByText("Linked asset unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("No assets linked to this risk yet.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /undefined/ })).not.toBeInTheDocument();
  });
  it("counts only open exposure in the risk heatmap", async () => {
    state.rows.risks.push({ ...state.rows.risks[0], id: "closed", status: "closed" });
    render(await RisksPage());
    expect(screen.getByText(/Remaining exposure for/)).toHaveTextContent("1 current risk, scored by likelihood");
    expect(screen.getByText("Not set")).toBeInTheDocument();
  });
  it("does not turn a failed risk read into a missing record", async () => {
    state.failTables.add("risks");
    await expect(RiskDetailPage({ params: Promise.resolve({ id: riskId }) })).rejects.toThrow("Could not load the risk");
  });
  it("does not calculate exposure with silently defaulted workspace thresholds", async () => {
    state.failTables.add("risk_matrix_config");
    await expect(RisksPage()).rejects.toThrow("Could not load the risk register");
  });
  it("connects tasks and linked evidence to the risk detail", async () => {
    state.rows.tasks = [{ id: "task-1", organisation_id: org, risk_id: riskId, title: "Review supplier access", status: "in_progress", due_on: "2026-09-30" }];
    state.rows.evidence_links = [{ id: "link-1", organisation_id: org, risk_id: riskId, evidence: { id: "evidence-1", title: "Access export", status: "current", kind: "document" } }];
    render(await RiskDetailPage({ params: Promise.resolve({ id: riskId }) }));
    expect(screen.getByRole("link", { name: "Review supplier access" })).toHaveAttribute("href", "/app/tasks/task-1");
    expect(screen.getByRole("link", { name: "Access export" })).toHaveAttribute("href", "/app/evidence?evidence=evidence-1#evidence-evidence-1");
    expect(screen.getByText(/Free-text references are supporting notes/)).toBeInTheDocument();
  });
  it("does not describe cancelled-only treatment work as complete", async () => {
    state.rows.risk_treatment_plans = [{ id: "plan-1", risk_id: riskId, organisation_id: org, reference: "RTP-001", status: "cancelled" }];
    render(await RiskDetailPage({ params: Promise.resolve({ id: riskId }) }));
    expect(screen.getByText(/1 cancelled/)).toBeInTheDocument();
    expect(screen.queryByText("All plans complete")).not.toBeInTheDocument();
  });
  it("suggests a treatment reference from the whole workspace", async () => {
    state.rows.risk_treatment_plans = [{ id: "plan-1", risk_id: "another-risk", organisation_id: org, reference: "RTP-001", status: "planned" }];
    render(await RiskDetailPage({ params: Promise.resolve({ id: riskId }) }));
    expect(screen.getByRole("textbox", { name: "Reference" })).toHaveValue("RTP-002");
  });
  it("paginates the whole workspace when suggesting a treatment reference", async () => {
    state.rows.risk_treatment_plans = Array.from({ length: 1001 }, (_, index) => ({
      id: `plan-${index + 1}`, risk_id: "another-risk", organisation_id: org,
      reference: `RTP-${String(index + 1).padStart(3, "0")}`, status: "planned",
    }));
    render(await RiskDetailPage({ params: Promise.resolve({ id: riskId }) }));
    expect(screen.getByRole("textbox", { name: "Reference" })).toHaveValue("RTP-1002");
  });
  it("keeps linked work, evidence state and authorised actions in responsive risk cards", async () => {
    state.rows.tasks = [{ id: "task-1", organisation_id: org, risk_id: riskId, title: "Review supplier access", status: "open" }];
    state.rows.evidence_links = [{ id: "link-1", organisation_id: org, risk_id: riskId, evidence: { status: "expired" } }];
    render(await RisksPage());
    expect(screen.getAllByRole("link", { name: "Review supplier access" })).toHaveLength(2);
    expect(screen.getAllByText(/Evidence: 1|1 linked · 1 expired/)).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Delete Supplier risk" })).toHaveLength(2);
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
