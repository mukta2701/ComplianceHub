import { beforeEach, describe, expect, it, vi } from "vitest";
const fixtures = vi.hoisted(() => ({ context: {} as Record<string, unknown>, rpc: vi.fn() }));
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => fixtures.context }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
import { saveBaselineAction } from "./actions";
const id = "98000000-0000-4000-8000-000000000101";
function form(intent = "snapshot") { const data = new FormData(); for (const [key,value] of Object.entries({ objective: "Start readiness", assessmentId: "", revision: "2", requestId: id, intent, organisationId: "untrusted", summary: "invented" })) data.set(key,value); return data; }
beforeEach(() => { fixtures.rpc.mockReset().mockResolvedValue({ data: { revision: 3, snapshot_id: id }, error: null }); fixtures.context = { supabase: { rpc: fixtures.rpc }, organisation: { id: "workspace" }, user: { id }, membership: { role: "owner" } }; });
describe("baseline saving", () => {
  it("saves only the objective, selection and exact revision through authenticated RPC", async () => {
    const result = await saveBaselineAction({},form());
    expect(result.snapshotId).toBe(id); expect(result.revision).toBe(3);
    expect(fixtures.rpc).toHaveBeenCalledWith("save_baseline_progress", { target_organisation_id: "workspace", expected_revision: 2, baseline_objective: "Start readiness", selected_assessment_id: null, save_request_id: id, create_snapshot: true });
  });
  it("saves a resumable draft without requesting a snapshot", async () => {
    await saveBaselineAction({},form("progress")); expect(fixtures.rpc.mock.calls[0][1].create_snapshot).toBe(false);
  });
  it("denies Member edits before calling RPC", async () => {
    fixtures.context.membership = { role: "member" };
    expect((await saveBaselineAction({},form())).error).toMatch(/coordinator/); expect(fixtures.rpc).not.toHaveBeenCalled();
  });
  it("explains stale input and conceals internal diagnostics", async () => {
    fixtures.rpc.mockResolvedValueOnce({ data: null, error: { code: "PT409" } });
    expect((await saveBaselineAction({},form())).error).toMatch(/Reload/);
    fixtures.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "secret trace" } });
    expect((await saveBaselineAction({},form())).error).not.toContain("secret");
  });
  it("rejects malformed selection and blank objective", async () => {
    const data=form(); data.set("objective"," ");
    expect((await saveBaselineAction({},data)).error).toMatch(/objective/);
    data.set("objective","Valid"); data.set("assessmentId","bad");
    expect((await saveBaselineAction({},data)).error).toBeTruthy(); expect(fixtures.rpc).not.toHaveBeenCalled();
  });
});
