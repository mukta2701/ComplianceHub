"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { workspaceAccess } from "@/features/organisations/domain/workspace-access";
import {
  createPolicyFeedbackSchema,
  feedbackDecisionSchema,
  feedbackStatusSchema,
  replyPolicyFeedbackSchema,
} from "@/features/policies/application/feedback";

const RATE_LIMIT = { limit: 20, windowMs: 60_000 } as const;

export async function decidePolicyFeedbackAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  if (!workspaceAccess(membership.role).section("policies").canManage) {
    throw new Error("Only workspace operators can decide feedback");
  }
  await enforceRateLimit(`policy-feedback:${user.id}`, RATE_LIMIT);
  const input = feedbackDecisionSchema.parse(Object.fromEntries(formData));
  const { data: thread, error: threadError } = await supabase
    .from("policy_feedback_threads").select("policy_id")
    .eq("id", input.threadId).eq("organisation_id", organisation.id).maybeSingle();
  if (threadError || !thread) throw new Error("Feedback thread not found in the active workspace");
  const { error } = await supabase.rpc("decide_policy_feedback", {
    target_thread_id: input.threadId,
    feedback_decision: input.decision,
    feedback_rationale: input.rationale,
  });
  if (error) throw new Error("Could not save policy feedback decision");
  revalidatePath(`/app/policies/${thread.policy_id}`);
  revalidatePath("/app/policies");
}

export async function createPolicyFeedbackAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`policy-feedback:${user.id}`, RATE_LIMIT);
  const input = createPolicyFeedbackSchema.parse(Object.fromEntries(formData));
  const { data: policy, error: policyError } = await supabase
    .from("policies").select("id")
    .eq("id", input.policyId).eq("organisation_id", organisation.id).maybeSingle();
  if (policyError || !policy) throw new Error("Policy not found in the active workspace");
  const { error } = await supabase.rpc("create_policy_feedback", {
    target_policy_id: input.policyId,
    feedback_subject: input.subject,
    feedback_body: input.body,
  });
  if (error) throw new Error("Could not create policy feedback");
  revalidatePath(`/app/policies/${input.policyId}`);
  revalidatePath("/app/policies");
}

export async function replyPolicyFeedbackAction(formData: FormData) {
  const { supabase, user, organisation } = await requireAppContext();
  await enforceRateLimit(`policy-feedback:${user.id}`, RATE_LIMIT);
  const input = replyPolicyFeedbackSchema.parse(Object.fromEntries(formData));
  const { data: thread, error: threadError } = await supabase
    .from("policy_feedback_threads").select("policy_id")
    .eq("id", input.threadId).eq("organisation_id", organisation.id).maybeSingle();
  if (threadError || !thread) throw new Error("Feedback thread not found in the active workspace");
  const { error } = await supabase.rpc("reply_policy_feedback", {
    target_thread_id: input.threadId,
    feedback_body: input.body,
  });
  if (error) throw new Error("Could not reply to policy feedback");
  revalidatePath(`/app/policies/${thread.policy_id}`);
}

export async function setPolicyFeedbackStatusAction(formData: FormData) {
  const { supabase, user, organisation, membership } = await requireAppContext();
  if (!workspaceAccess(membership.role).section("policies").canManage) {
    throw new Error("Only workspace operators can manage feedback");
  }
  await enforceRateLimit(`policy-feedback:${user.id}`, RATE_LIMIT);
  const input = feedbackStatusSchema.parse(Object.fromEntries(formData));
  const { data: thread, error: threadError } = await supabase
    .from("policy_feedback_threads").select("policy_id")
    .eq("id", input.threadId).eq("organisation_id", organisation.id).maybeSingle();
  if (threadError || !thread) throw new Error("Feedback thread not found in the active workspace");
  const { error } = await supabase.rpc("set_policy_feedback_status", {
    target_thread_id: input.threadId,
    resolved: input.resolved,
  });
  if (error) throw new Error("Could not update policy feedback status");
  revalidatePath(`/app/policies/${thread.policy_id}`);
  revalidatePath("/app/policies");
}
