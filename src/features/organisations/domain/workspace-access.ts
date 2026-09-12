import { hasCapability, type MembershipRole, type WorkspaceCapability } from "./access";

export type WorkspaceSectionId = "assessments" | "frameworks" | "leadership-report";

type WorkspaceNavigationGroup = "Compliance" | "Programme" | "Share" | null;

type WorkspacePathRequirement = "view" | "manage";

type WorkspacePathRule = {
  path: string | RegExp;
  requirement: WorkspacePathRequirement;
};

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
  manageDeniedMessage: string;
  canAccessPath: (pathname: string) => boolean;
  requireManage: () => void;
};

type WorkspaceSectionPolicy = {
  id: WorkspaceSectionId;
  href: string;
  label: string;
  title: string;
  icon: string;
  paths: readonly WorkspacePathRule[];
  viewRoles: ReadonlySet<MembershipRole>;
  navigationGroups: Partial<Record<MembershipRole, WorkspaceNavigationGroup>>;
  manageCapability: WorkspaceCapability;
  manageDeniedMessage: string;
};

const ASSESSMENT_DETAIL_PATH = /^\/app\/assessment\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pathMatches(rule: WorkspacePathRule, pathname: string): boolean {
  return typeof rule.path === "string" ? rule.path === pathname : rule.path.test(pathname);
}

const sectionPolicies: Record<WorkspaceSectionId, WorkspaceSectionPolicy> = {
  assessments: {
    id: "assessments",
    href: "/app/assessment",
    label: "Gap assessment",
    title: "Gap assessment",
    icon: "clipboard",
    paths: [
      { path: "/app/assessment", requirement: "view" },
      { path: ASSESSMENT_DETAIL_PATH, requirement: "view" },
      { path: "/api/app/assessment/complete", requirement: "manage" },
    ],
    viewRoles: new Set(["owner", "admin", "member"]),
    navigationGroups: { owner: "Programme", admin: "Programme" },
    manageCapability: "manage_assessments",
    manageDeniedMessage: "Only workspace operators can complete assessments.",
  },
  frameworks: {
    id: "frameworks",
    href: "/app/frameworks",
    label: "Framework coverage",
    title: "Framework coverage",
    icon: "file",
    paths: [{ path: "/app/frameworks", requirement: "view" }],
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
    paths: [
      { path: "/app/reports/readiness", requirement: "view" },
      { path: "/api/app/reports/readiness/pdf", requirement: "view" },
    ],
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
    manageDeniedMessage: policy.manageDeniedMessage,
    canAccessPath: (pathname) => {
      const rule = policy.paths.find((candidate) => pathMatches(candidate, pathname));
      if (!rule) return false;
      return rule.requirement === "manage" ? canManage : canView;
    },
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
        (candidate) => candidate.paths.some((rule) => pathMatches(rule, pathname)),
      );
      return policy ? sectionAccess(policy, role) : null;
    },
  };
}
