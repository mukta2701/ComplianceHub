import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "owner", rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => ({
  membership: { role: state.role }, user: { id: "owner" },
  organisation: { id: "82000000-0000-4000-8000-000000000001" },
  supabase: { rpc: state.rpc, from: state.from },
}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
import { createRtpAction } from "./rtp-actions";
import { redirect } from "next/navigation";

function input(spawnTask = true) {
  const form = new FormData();
  Object.entries({ riskId: "83000000-0000-4000-8000-000000000001", reference: "RTP-1", summary: "Mitigate access risk", treatmentMeasures: "Review access", assignedLeadId: "", targetCompletion: "2026-10-01", status: "planned", ...(spawnTask ? { spawnTask: "on" } : {}) }).forEach(([key, value]) => form.set(key, value));
  return form;
}
beforeEach(() => { vi.clearAllMocks(); state.role = "owner"; state.rpc.mockResolvedValue({ data: "plan-1", error: null }); });
it.each([true, false])("creates treatment and optional task together (spawn=%s)", async (spawn) => {
  await createRtpAction(input(spawn));
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith("create_treatment_with_task", {
    target_organisation_id: "82000000-0000-4000-8000-000000000001",
    plan_input: { risk_id: "83000000-0000-4000-8000-000000000001", reference: "RTP-1", summary: "Mitigate access risk", treatment_measures: "Review access", control_id: null, assigned_lead_id: null, target_completion: "2026-10-01", status: "planned", spawn_task: spawn },
  });
  expect(state.from).not.toHaveBeenCalled();
  expect(redirect).toHaveBeenCalledWith("/app/risks/83000000-0000-4000-8000-000000000001");
});
it("keeps the user on the form when the transaction fails", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: "task insert failed" } });
  await expect(createRtpAction(input())).rejects.toThrow("Could not save the treatment plan");
  expect(redirect).not.toHaveBeenCalled();
});
it("denies Member creation before touching storage", async () => {
  state.role = "member";
  await expect(createRtpAction(input())).rejects.toThrow("Only workspace operators");
  expect(state.rpc).not.toHaveBeenCalled();
  expect(state.from).not.toHaveBeenCalled();
});
