import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "owner", rows: {} as Record<string, Record<string, unknown>[]>, failTables: new Set<string>(), pageLimits: {} as Record<string, number>, emptyUpdate: false }));
const org = "10000000-0000-4000-8000-000000000001";
const assetId = "20000000-0000-4000-8000-000000000001";
const categoryId = "30000000-0000-4000-8000-000000000001";
const ownerId = "40000000-0000-4000-8000-000000000001";

function query(table: string) {
  let single = false;
  let limit = 1000;
  let patch: Record<string, unknown> | null = null;
  const filters: Array<(row: Record<string, unknown>) => boolean> = [];
  const chain: Record<string, unknown> = {};
  chain.eq = (key: string, value: unknown) => { filters.push((row) => row[key] === value); return chain; };
  for (const name of ["select", "order", "in", "not", "gt"]) chain[name] = () => chain;
  chain.limit = (value: number) => { limit = value; return chain; };
  chain.is = (key: string, value: unknown) => { filters.push((row) => row[key] === value); return chain; };
  chain.update = (value: Record<string, unknown>) => { patch = value; return chain; };
  for (const name of ["single", "maybeSingle"]) chain[name] = () => { single = true; return chain; };
  chain.then = (resolve: (value: unknown) => unknown) => {
    if (state.failTables.has(table)) return Promise.resolve({ data: null, error: { code: "08006" }, count: null }).then(resolve);
    let rows = (state.rows[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
    const count = rows.length;
    if (patch && state.emptyUpdate) rows = [];
    if (patch) for (const row of rows) Object.assign(row, patch);
    const pageLimit = Math.min(limit, state.pageLimits[table] ?? limit);
    return Promise.resolve({ data: single ? rows[0] ?? null : rows.slice(0, pageLimit), error: null, count }).then(resolve);
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
  usePathname: () => "/app/assets",
}));

import AssetsPage from "./page";
import AssetDetailPage from "./[id]/page";
import EditAssetPage from "./[id]/edit/page";
import { updateAssetAction, updateAssetFormAction } from "./edit-actions";

function form(overrides: Record<string, string> = {}) {
  const value = new FormData();
  for (const [key, item] of Object.entries({
    id: assetId, expectedUpdatedAt: "2026-09-10T01:00:00.000Z", reference: "AST-001", description: "Customer database",
    ownerLocation: "London", ownerId, categoryId, classification: "confidential", valueCriticality: "high",
    securityControls: "SSO", lifespan: "7 years", lastUpdated: "2026-09-10", remarks: "Quarterly review", ...overrides,
  })) value.set(key, item);
  return value;
}

beforeEach(() => {
  state.role = "owner"; state.failTables.clear(); state.pageLimits = {}; state.emptyUpdate = false;
  const asset = { id: assetId, organisation_id: org, reference: "AST-001", description: "Customer database", owner_location: "London", owner_id: ownerId, category_id: categoryId, classification: "confidential", value_criticality: "high", security_controls: "SSO", lifespan: "7 years", last_updated: "2026-09-10", remarks: "Quarterly review", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-10T01:00:00.000Z", asset_categories: { name: "Technology" } };
  state.rows = {
    assets: [asset],
    memberships: [{ organisation_id: org, user_id: ownerId, profiles: { display_name: "Ada Owner" } }],
    profiles: [{ id: ownerId, display_name: "Ada Owner" }],
    asset_categories: [{ organisation_id: org, id: categoryId, name: "Technology", position: 1 }],
    asset_risks: [{ organisation_id: org, asset_id: assetId, risk_id: "50000000-0000-4000-8000-000000000001", risks: { id: "50000000-0000-4000-8000-000000000001", reference: "R-001", title: "Supplier access", status: "open", residual_likelihood: 2, residual_impact: 3 } }],
    risks: [{ organisation_id: org, id: "50000000-0000-4000-8000-000000000001", reference: "R-001", title: "Supplier access", status: "open", residual_likelihood: 2, residual_impact: 3 }],
  };
});

describe("asset workspace", () => {
  it("shows accountability, handling and linked risk context in the register", async () => {
    render(await AssetsPage());
    expect(screen.getByRole("link", { name: "Export XLSX" })).toHaveAttribute("href", "/api/app/assets/export?format=xlsx");
    expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", "/api/app/assets/export?format=csv");
    expect(screen.getAllByText("Ada Owner").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1 linked risk/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText("Highly Confidential")).toHaveLength(0);
    expect(screen.getAllByText("Confidential").length).toBeGreaterThan(0);
  });

  it("keeps exact summary totals when the visible register is capped", async () => {
    const template = state.rows.assets[0];
    state.rows.assets = Array.from({ length: 501 }, (_, index) => ({
      ...template,
      id: `asset-${String(index).padStart(4, "0")}`,
      reference: `AST-${String(index + 1).padStart(3, "0")}`,
      owner_id: index < 13 ? null : ownerId,
      classification: index < 21 ? "highly_confidential" : "confidential",
      value_criticality: index < 34 ? "high" : "medium",
    }));
    state.pageLimits.assets = 2;
    state.rows.asset_risks = [];
    render(await AssetsPage());
    expect(screen.getByText("Showing 2 most recently updated of 501 assets")).toBeInTheDocument();
    expect(screen.getByText("Total assets").nextElementSibling).toHaveTextContent("501");
    expect(screen.getByText("High criticality", { selector: "small" }).nextElementSibling).toHaveTextContent("34");
    expect(screen.getByText("Highly confidential", { selector: "small" }).nextElementSibling).toHaveTextContent("21");
    expect(screen.getByText("Unassigned", { selector: "small" }).nextElementSibling).toHaveTextContent("13");
  });

  it("does not turn a failed register read into a first-use state", async () => {
    state.failTables.add("assets");
    await expect(AssetsPage()).rejects.toThrow("Could not load the asset inventory");
  });

  it("does not turn a failed detail read into a missing asset", async () => {
    state.failTables.add("assets");
    await expect(AssetDetailPage({ params: Promise.resolve({ id: assetId }) })).rejects.toThrow("Could not load the asset");
  });

  it("distinguishes an unavailable relationship from no linked risks", async () => {
    state.failTables.add("asset_risks");
    render(await AssetDetailPage({ params: Promise.resolve({ id: assetId }) }));
    expect(screen.getByRole("alert")).toHaveTextContent("Linked risks could not be loaded");
    expect(screen.queryByText("No risks linked yet.")).not.toBeInTheDocument();
  });

  it("shows linked risk status and residual exposure without a broken link", async () => {
    render(await AssetDetailPage({ params: Promise.resolve({ id: assetId }) }));
    expect(screen.getByRole("link", { name: "R-001: Supplier access" })).toHaveAttribute("href", "/app/risks/50000000-0000-4000-8000-000000000001");
    expect(screen.getByText(/Residual exposure 6/)).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("does not call an assigned member unassigned when their display name is blank", async () => {
    state.rows.memberships[0].profiles = { display_name: "  " };
    render(await AssetDetailPage({ params: Promise.resolve({ id: assetId }) }));
    expect(screen.getByText(ownerId)).toBeInTheDocument();
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
  });

  it("loads the saved owner, category and technical edit version", async () => {
    render(await EditAssetPage({ params: Promise.resolve({ id: assetId }) }));
    expect(screen.getByRole("combobox", { name: "In-app owner" })).toHaveValue(ownerId);
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue(categoryId);
    expect(document.querySelector('input[name="expectedUpdatedAt"]')).toHaveValue("2026-09-10T01:00:00.000Z");
  });

  it("keeps saved owner and category choices that fall beyond the ordinary option page", async () => {
    state.rows.memberships = [
      { organisation_id: org, user_id: "first-member", profiles: { display_name: "First member" } },
      { organisation_id: org, user_id: ownerId, profiles: { display_name: "Ada Owner" } },
    ];
    state.rows.asset_categories = [
      { organisation_id: org, id: "first-category", name: "First category", position: 0 },
      { organisation_id: org, id: categoryId, name: "Technology", position: 1000 },
    ];
    state.pageLimits.memberships = 1;
    state.pageLimits.asset_categories = 1;
    render(await EditAssetPage({ params: Promise.resolve({ id: assetId }) }));
    expect(screen.getByRole("option", { name: "Ada Owner" })).toHaveValue(ownerId);
    expect(screen.getByRole("option", { name: "Technology" })).toHaveValue(categoryId);
  });

  it("rejects a stale save without overwriting the newer asset", async () => {
    state.rows.assets[0].updated_at = "2026-09-10T02:00:00.000Z";
    const result = await updateAssetFormAction({}, form());
    expect(result).toEqual({ error: "This asset changed or is no longer available. Reload it before saving again.", conflict: true });
    expect(state.rows.assets[0].description).toBe("Customer database");
  });

  it("uses a conditional write so a race cannot overwrite a newer asset", async () => {
    state.emptyUpdate = true;
    await expect(updateAssetAction(form())).rejects.toThrow("This asset changed or is no longer available");
  });
});
