import { beforeEach, describe, expect, it, vi } from "vitest";

const POLICY_ID = "7b000000-0000-4000-8000-000000000001";
const THREAD_ID = "7b000000-0000-4000-8000-000000000002";
const ORGANISATION_ID = "7b000000-0000-4000-8000-000000000003";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  enforceRateLimit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));

import { createPolicyFeedbackAction, replyPolicyFeedbackAction, setPolicyFeedbackStatusAction } from "./feedback-actions";

function scopedRow(data: unknown) {
  const chain = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }) };
  chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain);
  return chain;
}

describe("policy feedback actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("validates, rate-limits, active-org scopes, and delegates thread creation to the RPC", async () => {
    const policy = scopedRow({ id: POLICY_ID });
    const rpc = vi.fn().mockResolvedValue({ data: THREAD_ID, error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn((table) => table === "policies" ? policy : null), rpc },
      user: { id: "user-1" }, organisation: { id: ORGANISATION_ID }, membership: { role: "member" },
    };
    const form = new FormData();
    form.set("policyId", POLICY_ID); form.set("subject", "  Clarify scope  "); form.set("body", "  Does this cover contractors?  ");

    await createPolicyFeedbackAction(form);

    expect(hoisted.enforceRateLimit).toHaveBeenCalledWith("policy-feedback:user-1", { limit: 20, windowMs: 60_000 });
    expect(policy.eq).toHaveBeenCalledWith("organisation_id", ORGANISATION_ID);
    expect(rpc).toHaveBeenCalledWith("create_policy_feedback", {
      target_policy_id: POLICY_ID, feedback_subject: "Clarify scope", feedback_body: "Does this cover contractors?",
    });
    expect(hoisted.revalidatePath).toHaveBeenCalledWith(`/app/policies/${POLICY_ID}`);
  });

  it("rejects invalid feedback before any table or RPC access", async () => {
    const from = vi.fn(); const rpc = vi.fn();
    hoisted.ctx = { supabase: { from, rpc }, user: { id: "user-1" }, organisation: { id: ORGANISATION_ID }, membership: { role: "member" } };
    const form = new FormData(); form.set("policyId", POLICY_ID); form.set("subject", "x"); form.set("body", "Comment");

    await expect(createPolicyFeedbackAction(form)).rejects.toThrow();

    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("derives the policy destination from an active-org-scoped thread before replying", async () => {
    const thread = scopedRow({ policy_id: POLICY_ID });
    const rpc = vi.fn().mockResolvedValue({ data: "comment-1", error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => thread), rpc }, user: { id: "user-1" },
      organisation: { id: ORGANISATION_ID }, membership: { role: "member" },
    };
    const form = new FormData(); form.set("threadId", THREAD_ID); form.set("body", "Thanks for clarifying");

    await replyPolicyFeedbackAction(form);

    expect(thread.eq).toHaveBeenCalledWith("organisation_id", ORGANISATION_ID);
    expect(rpc).toHaveBeenCalledWith("reply_policy_feedback", { target_thread_id: THREAD_ID, feedback_body: "Thanks for clarifying" });
    expect(hoisted.revalidatePath).toHaveBeenCalledWith(`/app/policies/${POLICY_ID}`);
  });

  it("does not expose feedback management to a Member action caller", async () => {
    const rpc = vi.fn();
    hoisted.ctx = { supabase: { from: vi.fn(), rpc }, user: { id: "user-1" }, organisation: { id: ORGANISATION_ID }, membership: { role: "member" } };
    const form = new FormData(); form.set("threadId", THREAD_ID); form.set("resolved", "true");

    await expect(setPolicyFeedbackStatusAction(form)).rejects.toThrow("Only workspace operators can manage feedback");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("active-org scopes an operator status change before delegating resolution to the RPC", async () => {
    const thread = scopedRow({ policy_id: POLICY_ID });
    const rpc = vi.fn().mockResolvedValue({ data: THREAD_ID, error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => thread), rpc }, user: { id: "admin-1" },
      organisation: { id: ORGANISATION_ID }, membership: { role: "admin" },
    };
    const form = new FormData(); form.set("threadId", THREAD_ID); form.set("resolved", "false");

    await setPolicyFeedbackStatusAction(form);

    expect(thread.eq).toHaveBeenCalledWith("organisation_id", ORGANISATION_ID);
    expect(rpc).toHaveBeenCalledWith("set_policy_feedback_status", { target_thread_id: THREAD_ID, resolved: false });
    expect(hoisted.revalidatePath).toHaveBeenCalledWith(`/app/policies/${POLICY_ID}`);
  });
});
