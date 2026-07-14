"use server";

import { revalidatePath } from "next/cache";
import { requireAppContext } from "@/lib/app-context";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { hasCapability } from "@/features/organisations/domain/access";
import {
  createPolicyFeedbackSchema,
  feedbackStatusSchema,
  replyPolicyFeedbackSchema,
} from "@/features/policies/application/feedback";

const RATE_LIMIT = { limit: 20, windowMs: 60_000 } as const;

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
  if (!hasCapability(membership.role, "manage_policies")) {
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
}
