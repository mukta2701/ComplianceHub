import { hasCapability, type MembershipRole, type WorkspaceCapability } from "./access";

export type WorkspaceSectionId = "frameworks";

type WorkspaceNavigationItem = {
  group: "Compliance";
  href: string;
  label: string;
  icon: string;
};

export type WorkspaceSectionAccess = {
  id: WorkspaceSectionId;
  href: string;
  label: string;
  title: string;
  icon: string;
  canView: boolean;
  canManage: boolean;
  navigation: WorkspaceNavigationItem | null;
  requireManage: () => void;
};

type WorkspaceSectionPolicy = {
  id: WorkspaceSectionId;
  href: string;
  label: string;
  title: string;
  icon: string;
  navigationGroup: WorkspaceNavigationItem["group"];
  viewRoles: ReadonlySet<MembershipRole>;
  navigationRoles: ReadonlySet<MembershipRole>;
  manageCapability: WorkspaceCapability;
  manageDeniedMessage: string;
};

const sectionPolicies: Record<WorkspaceSectionId, WorkspaceSectionPolicy> = {
  frameworks: {
    id: "frameworks",
    href: "/app/frameworks",
    label: "Framework coverage",
    title: "Framework coverage",
    icon: "file",
    navigationGroup: "Compliance",
    viewRoles: new Set(["owner", "admin", "member"]),
    navigationRoles: new Set(["member"]),
    manageCapability: "manage_frameworks",
    manageDeniedMessage: "Only workspace operators can manage framework mappings",
  },
};

function sectionAccess(
  policy: WorkspaceSectionPolicy,
  role: MembershipRole | null,
): WorkspaceSectionAccess {
  const canView = role !== null && policy.viewRoles.has(role);
  const canManage = role !== null && hasCapability(role, policy.manageCapability);
  return {
    id: policy.id,
    href: policy.href,
    label: policy.label,
    title: policy.title,
    icon: policy.icon,
    canView,
    canManage,
    navigation: role !== null && policy.navigationRoles.has(role)
      ? {
          group: policy.navigationGroup,
          href: policy.href,
          label: policy.label,
          icon: policy.icon,
        }
      : null,
    requireManage: () => {
      if (!canManage) throw new Error(policy.manageDeniedMessage);
    },
  };
}

export function workspaceAccess(role: MembershipRole | null) {
  return {
    section(sectionId: WorkspaceSectionId): WorkspaceSectionAccess {
      return sectionAccess(sectionPolicies[sectionId], role);
    },
    sectionForPath(pathname: string): WorkspaceSectionAccess | null {
      const policy = Object.values(sectionPolicies).find((candidate) => candidate.href === pathname);
      return policy ? sectionAccess(policy, role) : null;
    },
  };
}
