export const membershipRoles = ["owner", "admin", "member"] as const;
export type MembershipRole = (typeof membershipRoles)[number];

export type WorkspaceCapability =
  | "run_monitoring"
  | "manage_monitoring"
  | "manage_policies"
  | "manage_connections"
  | "manage_trust_center"
  | "manage_members"
  | "manage_owners";

const capabilities: Record<MembershipRole, ReadonlySet<WorkspaceCapability>> = {
  owner: new Set([
    "run_monitoring", "manage_monitoring", "manage_policies",
    "manage_connections", "manage_trust_center", "manage_members", "manage_owners",
  ]),
  admin: new Set([
    "run_monitoring", "manage_monitoring", "manage_policies",
    "manage_connections", "manage_trust_center", "manage_members",
  ]),
  member: new Set(),
};

export function hasCapability(role: MembershipRole, capability: WorkspaceCapability): boolean {
  return capabilities[role].has(capability);
}

export function canInviteRole(actorRole: MembershipRole, invitedRole: MembershipRole): boolean {
  if (invitedRole === "owner") return false;
  return actorRole === "owner" || (actorRole === "admin" && invitedRole === "member");
}

export function canManageMembership(
  actorRole: MembershipRole,
  targetRole: MembershipRole,
  nextRole: MembershipRole = targetRole,
): boolean {
  if (actorRole === "owner") return true;
  return actorRole === "admin" && targetRole === "member" && nextRole === "member";
}

export function roleLabel(role: MembershipRole): string {
  return role[0].toUpperCase() + role.slice(1);
}
