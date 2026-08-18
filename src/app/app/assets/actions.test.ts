import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: () => Promise.resolve() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { linkAssetRiskAction, unlinkAssetRiskAction } from "./actions";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("asset-to-risk link actions validate identifiers", () => {
  beforeEach(() => {
    hoisted.ctx = {
      user: { id: "88000000-0000-4000-8000-000000000001" },
      organisation: { id: "88000000-0000-4000-8000-000000000002" },
      supabase: { from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ error: null }), delete: vi.fn() })) },
    };
  });

  it("rejects a blank asset or risk id before linking", async () => {
    await expect(linkAssetRiskAction(form({ assetId: "", riskId: "" }))).rejects.toThrow("Asset and risk IDs are required");
    expect((hoisted.ctx as { supabase: { from: ReturnType<typeof vi.fn> } }).supabase.from).not.toHaveBeenCalled();
  });

  it("rejects a blank asset or risk id before unlinking", async () => {
    await expect(unlinkAssetRiskAction(form({ assetId: "", riskId: "" }))).rejects.toThrow("Asset and risk IDs are required");
    expect((hoisted.ctx as { supabase: { from: ReturnType<typeof vi.fn> } }).supabase.from).not.toHaveBeenCalled();
  });
});
