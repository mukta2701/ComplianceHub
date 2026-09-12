import { hasCapability, type MembershipRole, type WorkspaceCapability } from "./access";

export type WorkspaceSectionId = "frameworks" | "leadership-report";

type WorkspaceNavigationGroup = "Compliance" | "Share" | null;

type WorkspaceNavigationItem = {
  group: WorkspaceNavigationGroup;
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
  apiPaths: readonly string[];
  viewRoles: ReadonlySet<MembershipRole>;
  navigationGroups: Partial<Record<MembershipRole, WorkspaceNavigationGroup>>;
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
    apiPaths: [],
    viewRoles: new Set(["owner", "admin", "member"]),
    navigationGroups: { member: "Compliance" },
    manageCapability: "manage_frameworks",
    manageDeniedMessage: "Only workspace operators can manage framework mappings",
  },
  "leadership-report": {
    id: "leadership-report",
    href: "/app/reports/readiness",
    label: "Leadership report",
    title: "Leadership report",
    icon: "file",
    apiPaths: ["/api/app/reports/readiness/pdf"],
    viewRoles: new Set(["owner", "admin", "member"]),
    navigationGroups: { owner: "Share", admin: "Share", member: null },
    manageCapability: "manage_policies",
    manageDeniedMessage: "Only workspace operators can publish leadership reports",
  },
};

function sectionAccess(
  policy: WorkspaceSectionPolicy,
  role: MembershipRole | null,
): WorkspaceSectionAccess {
  const canView = role !== null && policy.viewRoles.has(role);
  const canManage = role !== null && hasCapability(role, policy.manageCapability);
  const navigationGroup = role === null ? undefined : policy.navigationGroups[role];
  return {
    id: policy.id,
    href: policy.href,
    label: policy.label,
    title: policy.title,
    icon: policy.icon,
    canView,
    canManage,
    navigation: navigationGroup !== undefined
      ? {
          group: navigationGroup,
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
      const policy = Object.values(sectionPolicies).find(
        (candidate) => candidate.href === pathname || candidate.apiPaths.includes(pathname),
      );
      return policy ? sectionAccess(policy, role) : null;
    },
  };
}
