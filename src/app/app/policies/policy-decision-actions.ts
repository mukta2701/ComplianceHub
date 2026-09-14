"use server";

import { unstable_rethrow } from "next/navigation";
import { acceptPolicyAction, approvePolicyAction, setPolicyStatusAction } from "./actions";

export type PolicyDecisionState = { error?: string; success?: string };

function safeDecisionError(error: unknown, fallback: string): PolicyDecisionState {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("changed")) return { error: message };
  if (message.includes("no longer allows") || message.includes("Only workspace operators")) return { error: "Your access no longer allows this policy decision. Refresh to see your current access." };
  return { error: fallback };
}

export async function submitPolicyApprovalAction(_previous: PolicyDecisionState, form: FormData): Promise<PolicyDecisionState> {
  try { await approvePolicyAction(form); return { success: "Policy approved." }; }
  catch (error) { unstable_rethrow(error); return safeDecisionError(error, "Could not approve the policy. Refresh and review the saved policy before trying again."); }
}

export async function submitPolicyStatusAction(_previous: PolicyDecisionState, form: FormData): Promise<PolicyDecisionState> {
  try { await setPolicyStatusAction(form); return { success: "Policy status changed." }; }
  catch (error) { unstable_rethrow(error); return safeDecisionError(error, "Could not change the policy status. Refresh and review the saved policy before trying again."); }
}

export async function submitPolicyAcceptanceAction(_previous: PolicyDecisionState, form: FormData): Promise<PolicyDecisionState> {
  try { await acceptPolicyAction(form); return { success: "Your acceptance was recorded." }; }
  catch (error) { unstable_rethrow(error); return safeDecisionError(error, "Could not record your acceptance. Refresh and read the policy before trying again."); }
}
