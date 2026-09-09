import { beforeEach, describe, expect, it, vi } from "vitest";
const fixtures = vi.hoisted(() => ({ context: {} as Record<string, unknown>, rpc: vi.fn() }));
vi.mock("@/lib/app-context", () => ({ requireAppContext: async () => fixtures.context }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
import { submitTaskContributionAction, reviewTaskContributionAction } from "./contribution-actions";
const id = "97000000-0000-4000-8000-000000000101";
const org = "97000000-0000-4000-8000-000000000001";
function form(values: Record<string,string>) { const data = new FormData(); for (const [k,v] of Object.entries(values)) data.set(k,v); return data; }
const note = () => form({ taskId: id, requestId: id, assignmentRevision: "2", note: "Saved proof" });
const review = () => form({ taskId: id, contributionId: id, requestId: id, decision: "accepted", rationale: "Checked" });
beforeEach(() => { fixtures.rpc.mockReset().mockResolvedValue({ data: id, error: null }); fixtures.context = { supabase: { rpc: fixtures.rpc }, organisation: { id: org }, user: { id }, membership: { role: "member" } }; });
describe("task contribution actions", () => {
  it("submits through session RPC with server-derived workspace and exact revision", async () => {
    const data = note(); data.set("organisationId", id);
    expect(await submitTaskContributionAction({}, data)).toEqual({ success: "Your note is awaiting coordinator review." });
    expect(fixtures.rpc).toHaveBeenCalledWith("submit_task_contribution", { target_organisation_id: org, target_task_id: id, expected_assignment_revision: 2, submission_note: "Saved proof", submission_request_id: id });
  });
  it("returns usable validation feedback without calling the database", async () => {
    const data = note(); data.set("note", " ");
    expect((await submitTaskContributionAction({}, data)).error).toMatch(/Describe/);
    expect(fixtures.rpc).not.toHaveBeenCalled();
  });
  it("explains stale assignments without reporting success", async () => {
    fixtures.rpc.mockResolvedValue({ data: null, error: { message: "task assignment changed; reload the task", code: "PT409" } });
    expect(await submitTaskContributionAction({}, note())).toEqual({ error: "The assignment changed. Reload this task before continuing." });
  });
  it("does not expose unexpected database diagnostics", async () => {
    fixtures.rpc.mockResolvedValue({ data: null, error: { message: "private database diagnostics", code: "XX000" } });
    expect((await submitTaskContributionAction({}, note())).error).toBe("Could not save your contribution. Please try again.");
  });
  it("denies member reviews before RPC", async () => {
    expect((await reviewTaskContributionAction({}, review())).error).toMatch(/coordinator/);
    expect(fixtures.rpc).not.toHaveBeenCalled();
  });
  it("reviews the exact submission and reuses browser request identity", async () => {
    fixtures.context.membership = { role: "admin" };
    expect(await reviewTaskContributionAction({}, review())).toEqual({ success: "Evidence accepted. Task and finding statuses are unchanged." });
    expect(fixtures.rpc).toHaveBeenCalledWith("review_task_contribution", { target_organisation_id: org, target_contribution_id: id, review_decision: "accepted", review_rationale: "Checked", review_request_id: id });
  });
});
