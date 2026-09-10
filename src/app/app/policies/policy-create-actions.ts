"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { createPolicyAction } from "./actions";

export type PolicyFormState = { error?: string; fieldErrors?: Record<string, string[] | undefined> };

export async function createPolicyFormAction(_previous: PolicyFormState, form: FormData): Promise<PolicyFormState> {
  try {
    await createPolicyAction(form);
    return {};
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof z.ZodError) return { error: "Check the highlighted fields and try again.", fieldErrors: error.flatten().fieldErrors };
    if (error instanceof Error && error.message === "Could not create the policy") return { error: "Could not create the policy. Your entries are still shown; check them and try again." };
    throw error;
  }
}
