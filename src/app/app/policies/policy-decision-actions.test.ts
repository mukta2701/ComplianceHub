import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ accept: vi.fn(), approve: vi.fn(), status: vi.fn() }));
vi.mock("./actions", () => ({ acceptPolicyAction: mocks.accept, approvePolicyAction: mocks.approve, setPolicyStatusAction: mocks.status }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
import { submitPolicyAcceptanceAction, submitPolicyApprovalAction, submitPolicyStatusAction } from "./policy-decision-actions";

beforeEach(() => vi.clearAllMocks());

it("returns the stale acceptance instruction inline", async () => {
  mocks.accept.mockRejectedValueOnce(new Error("This policy changed. Refresh and read the current version before accepting it."));
  await expect(submitPolicyAcceptanceAction({}, new FormData())).resolves.toEqual({ error: "This policy changed. Refresh and read the current version before accepting it." });
});

it("returns stale approval and status conflicts without losing the document", async () => {
  mocks.approve.mockRejectedValueOnce(new Error("This policy changed while you were editing it. Refresh and try again."));
  mocks.status.mockRejectedValueOnce(new Error("This policy changed while you were editing it. Refresh and try again."));
  await expect(submitPolicyApprovalAction({}, new FormData())).resolves.toEqual({ error: "This policy changed while you were editing it. Refresh and try again." });
  await expect(submitPolicyStatusAction({}, new FormData())).resolves.toEqual({ error: "This policy changed while you were editing it. Refresh and try again." });
});

it("reports confirmed decisions", async () => {
  await expect(submitPolicyApprovalAction({}, new FormData())).resolves.toEqual({ success: "Policy approved." });
  await expect(submitPolicyStatusAction({}, new FormData())).resolves.toEqual({ success: "Policy status changed." });
  await expect(submitPolicyAcceptanceAction({}, new FormData())).resolves.toEqual({ success: "Your acceptance was recorded." });
});
