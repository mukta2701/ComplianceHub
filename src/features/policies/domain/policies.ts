export type PolicyStatus = "draft" | "in_review" | "approved" | "archived";

export const POLICY_STATUS_LABEL: Record<PolicyStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  archived: "Archived",
};
export const POLICY_STATUS_TONE: Record<PolicyStatus, string> = {
  draft: "neutral",
  in_review: "amber",
  approved: "green",
  archived: "neutral",
};

// A material edit is any change to the policy text once whitespace is normalised.
// Fixing the review date or re-approving is NOT a body change, so it never bumps
// the version (Task 6 only calls isMaterialPolicyEdit when body is submitted).
export function normalisePolicyBody(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

export function isMaterialPolicyEdit(previousBody: string, nextBody: string): boolean {
  return normalisePolicyBody(previousBody) !== normalisePolicyBody(nextBody);
}

// Acceptances are version-stamped (accepted_version). Only acceptances recorded
// at the CURRENT policy version count: a material edit bumps policies.version,
// which invalidates every prior acceptance by construction (no delete needed).
export function summarisePolicyAcceptances(
  currentVersion: number,
  acceptances: readonly { accepted_version: number }[],
  memberCount: number,
): { acceptedCurrent: number; total: number; percent: number; outstanding: number } {
  const acceptedCurrent = acceptances.filter((a) => a.accepted_version === currentVersion).length;
  const total = memberCount;
  return {
    acceptedCurrent,
    total,
    percent: total === 0 ? 0 : Math.round((acceptedCurrent / total) * 100),
    outstanding: Math.max(0, total - acceptedCurrent),
  };
}
