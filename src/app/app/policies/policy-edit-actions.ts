"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { updatePolicyAction } from "./actions";

export type PolicyEditState = { error?: string; success?: string; version?: number; revision?: number; fieldErrors?: Record<string, string[] | undefined> };

export async function savePolicyEditAction(_state: PolicyEditState, form: FormData): Promise<PolicyEditState> {
  try {
    const saved = await updatePolicyAction(form);
    if (saved.notificationFailed) {
      return { error: "The policy was saved, but members could not be notified to re-accept. Check the acceptance roster and follow up with them.", version: saved.version, revision: saved.revision };
    }
    return { success: "Policy changes saved.", version: saved.version, revision: saved.revision };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof z.ZodError) return { error: "Check the highlighted fields and try again.", fieldErrors: error.flatten().fieldErrors };
    const message = error instanceof Error ? error.message : "";
    if (message === "This policy changed while you were editing it. Refresh and try again.") {
      return { error: "This policy changed while you were editing it. Your entries are still shown. Copy them before refreshing, then review the latest policy before saving again." };
    }
    if (message === "Only workspace operators can manage policies") return { error: "Your access no longer allows policy edits. Your entries are still shown." };
    return { error: "Could not save the policy. Your entries are still shown. Check the details and try again." };
  }
}
