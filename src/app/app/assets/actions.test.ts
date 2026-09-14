import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: () => Promise.resolve() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { createAssetAction, deleteAssetAction, linkAssetRiskAction, unlinkAssetRiskAction, updateAssetAction } from "./actions";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const validAsset = {
  reference: "AST-001", description: "Laptop", ownerLocation: "London", ownerId: "",
  classification: "internal_use_only", valueCriticality: "medium", categoryId: "",
  securityControls: "", lifespan: "", lastUpdated: "", remarks: "",
};
const ASSET_ID = "77000000-0000-4000-8000-000000000001";
const RISK_ID = "77000000-0000-4000-8000-000000000002";
const UPDATED_AT = "2026-09-10T01:00:00.000Z";

function context(role: "owner" | "admin" | "member" = "owner", result: { data?: unknown; error?: unknown } = { data: { id: ASSET_ID, updated_at: UPDATED_AT }, error: null }) {
  const eq = vi.fn().mockReturnThis();
  const select = vi.fn().mockReturnThis();
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const insert = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq, select, maybeSingle });
  const del = vi.fn().mockReturnValue({ eq, select, maybeSingle });
  const from = vi.fn((table: string) => table === "assets" ? { insert, update, delete: del, select, eq, maybeSingle } : { insert, delete: del });
  hoisted.ctx = {
    user: { id: "88000000-0000-4000-8000-000000000001" },
    organisation: { id: "88000000-0000-4000-8000-000000000002" }, membership: { role },
    supabase: { from },
  };
  return { from, insert, update, del, eq, select, maybeSingle };
}

describe("asset-to-risk link actions validate identifiers", () => {
  beforeEach(() => {
    context();
  });

  it("rejects a blank asset or risk id before linking", async () => {
    await expect(linkAssetRiskAction(form({ assetId: "", riskId: "" }))).rejects.toThrow("Asset and risk IDs are required");
    expect((hoisted.ctx as { supabase: { from: ReturnType<typeof vi.fn> } }).supabase.from).not.toHaveBeenCalled();
  });

  it("rejects a blank asset or risk id before unlinking", async () => {
    await expect(unlinkAssetRiskAction(form({ assetId: "", riskId: "" }))).rejects.toThrow("Asset and risk IDs are required");
    expect((hoisted.ctx as { supabase: { from: ReturnType<typeof vi.fn> } }).supabase.from).not.toHaveBeenCalled();
  });

  it.each(["member"] as const)("rejects %s from every asset mutation", async (role) => {
    const controls = context(role);
    await expect(createAssetAction(form(validAsset))).rejects.toThrow("Only workspace operators");
    await expect(updateAssetAction(form({ ...validAsset, id: ASSET_ID, expectedUpdatedAt: UPDATED_AT }))).rejects.toThrow("Only workspace operators");
    await expect(deleteAssetAction(form({ id: ASSET_ID }))).rejects.toThrow("Only workspace operators");
    await expect(linkAssetRiskAction(form({ assetId: ASSET_ID, riskId: RISK_ID }))).rejects.toThrow("Only workspace operators");
    await expect(unlinkAssetRiskAction(form({ assetId: ASSET_ID, riskId: RISK_ID }))).rejects.toThrow("Only workspace operators");
    expect(controls.from).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin"] as const)("allows %s to create an asset", async (role) => {
    const controls = context(role);
    await createAssetAction(form(validAsset));
    expect(controls.insert).toHaveBeenCalledWith(expect.objectContaining({ organisation_id: "88000000-0000-4000-8000-000000000002" }));
  });

  it("allows an admin to update, delete, link, and unlink within the active workspace", async () => {
    const controls = context("admin");
    await updateAssetAction(form({ ...validAsset, id: ASSET_ID, expectedUpdatedAt: UPDATED_AT }));
    await deleteAssetAction(form({ id: ASSET_ID }));
    await linkAssetRiskAction(form({ assetId: ASSET_ID, riskId: RISK_ID }));
    await unlinkAssetRiskAction(form({ assetId: ASSET_ID, riskId: RISK_ID }));
    expect(controls.from).toHaveBeenCalledWith("assets");
    expect(controls.from).toHaveBeenCalledWith("asset_risks");
    expect(controls.eq).toHaveBeenCalledWith("organisation_id", "88000000-0000-4000-8000-000000000002");
  });

  it("fails update, delete, and unlink when the tenant-scoped row is absent", async () => {
    const controls = context("owner", { data: null, error: null });
    await expect(updateAssetAction(form({ ...validAsset, id: ASSET_ID, expectedUpdatedAt: UPDATED_AT }))).rejects.toThrow("Asset not found");
    await expect(deleteAssetAction(form({ id: ASSET_ID }))).rejects.toThrow("Asset not found");
    await expect(unlinkAssetRiskAction(form({ assetId: ASSET_ID, riskId: RISK_ID }))).rejects.toThrow("Asset risk link not found");
    expect(controls.eq).toHaveBeenCalledWith("organisation_id", "88000000-0000-4000-8000-000000000002");
  });
});
