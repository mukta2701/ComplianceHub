import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: { id: "user" } as { id: string } | null, role: "owner", org: "91000000-0000-4000-8000-000000000010", rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) }, rpc: state.rpc }) }));
vi.mock("@/lib/app-context", () => ({ getMembership: async () => ({ organisation_id: state.org, role: state.role }) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { POST } from "./route";
const sessionId = "91000000-0000-4000-8000-000000000030";
function request(body: unknown = { sessionId, expectedRevision: 2 }) { return new Request("http://localhost/api/app/assessment/complete", { method: "POST", body: JSON.stringify(body) }); }
beforeEach(() => { state.user = { id: "user" }; state.role = "owner"; state.rpc.mockReset().mockResolvedValue({ data: 2, error: null }); });
describe("assessment completion endpoint", () => {
  it.each(["owner", "admin"])("completes as %s using only the active workspace", async (role) => {
    state.role = role;
    const response = await POST(request({ sessionId, expectedRevision: 2, organisationId: "untrusted" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "completed", revision: 2 });
    expect(state.rpc).toHaveBeenCalledWith("complete_assessment", { target_organisation_id: state.org, target_session_id: sessionId, expected_revision: 2 });
  });
  it("rejects a Member before invoking completion", async () => { state.role = "member"; expect((await POST(request())).status).toBe(403); expect(state.rpc).not.toHaveBeenCalled(); });
  it("rejects unauthenticated completion", async () => { state.user = null; expect((await POST(request())).status).toBe(401); expect(state.rpc).not.toHaveBeenCalled(); });
  it("rejects invalid input", async () => { expect((await POST(request({ sessionId, expectedRevision: -1 }))).status).toBe(400); expect(state.rpc).not.toHaveBeenCalled(); });
  it.each([["40001", 409], ["23514", 422], ["P0002", 404], ["42501", 403], ["XX000", 500]] as const)("maps %s to %s without leaking database details", async (code, status) => {
    state.rpc.mockResolvedValue({ data: null, error: { code, message: "private internal error" } });
    const response = await POST(request()); expect(response.status).toBe(status); expect(await response.text()).not.toContain("private internal error");
  });
});
