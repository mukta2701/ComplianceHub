import { hasCapability, type MembershipRole } from "@/features/organisations/domain/access";
import { summarisePolicyAcceptances } from "./policies";

export function policyPortalAccess(role: MembershipRole) {
  const canManage = hasCapability(role, "manage_policies");
  return {
    canManage,
    loadRoster: canManage,
    showOrganisationProgress: canManage,
  };
}

export function policyAcceptancePresentation(
  role: MembershipRole,
  userId: string,
  currentVersion: number,
  acceptances: readonly { user_id: string; accepted_version: number }[],
  memberCount: number,
) {
  if (!hasCapability(role, "manage_policies")) {
    return {
      mode: "personal" as const,
      acceptedCurrent: acceptances.some(
        (acceptance) => acceptance.user_id === userId && acceptance.accepted_version === currentVersion,
      ),
    };
  }

  return {
    mode: "organisation" as const,
    ...summarisePolicyAcceptances(currentVersion, acceptances, memberCount),
  };
}
