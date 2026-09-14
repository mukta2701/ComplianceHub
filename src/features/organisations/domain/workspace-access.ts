import { hasCapability, type MembershipRole, type WorkspaceCapability } from "./access";

export type WorkspaceSectionId = "assets" | "assessments" | "audit-activity" | "audits" | "automation-setup" | "baseline" | "evidence" | "frameworks" | "leadership-report" | "notifications" | "overview" | "policies" | "risks" | "scope" | "soa" | "tasks" | "trust-center";

export type WorkspaceSectionPresentation = "member" | "operator";

type WorkspaceNavigationGroup = "Compliance" | "Oversight" | "Programme" | "Share" | "Work" | null;

type WorkspacePathRequirement = "view" | "manage";

type WorkspacePathRule = {
  path: string | RegExp;
  requirement: WorkspacePathRequirement;
  title?: string;
};

type WorkspaceManageOperation =
  | "auditor-access"
  | "create-task"
  | "edit-task"
  | "push-task-to-tracker"
  | "review-task-contributions"
  | "update-task-status";

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
  presentation: WorkspaceSectionPresentation | null;
  manageDeniedMessage: string | null;
  canAccessPath: (pathname: string) => boolean;
  titleForPath: (pathname: string) => string | null;
  canManageOperation: (operation?: WorkspaceManageOperation) => boolean;
  manageDeniedMessageFor: (operation?: WorkspaceManageOperation) => string;
  requireManage: (operation?: WorkspaceManageOperation) => void;
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
  rolePresentation?: Partial<Record<MembershipRole, {
    label: string;
    title: string;
    presentation: WorkspaceSectionPresentation;
    navigationHref?: string;
  }>>;
  manageCapability?: WorkspaceCapability;
  manageDeniedMessage: string | null;
  operationCapabilities?: Partial<Record<WorkspaceManageOperation, WorkspaceCapability>>;
  operationDeniedMessages?: Partial<Record<WorkspaceManageOperation, string>>;
};

const ASSESSMENT_DETAIL_PATH = /^\/app\/assessment\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASSET_DETAIL_PATH = /^\/app\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASSET_EDIT_PATH = /^\/app\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/edit$/i;
const AUDIT_DETAIL_PATH = /^\/app\/audits\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIT_PACK_PATH = /^\/api\/app\/audits\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/pack$/i;
const AUDITOR_LINK_PATH = /^\/api\/app\/audits\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/auditor-link$/i;
const POLICY_DETAIL_PATH = /^\/app\/policies\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RISK_DETAIL_PATH = /^\/app\/risks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RISK_EDIT_PATH = /^\/app\/risks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/edit$/i;
const SOA_DETAIL_PATH = /^\/app\/soa\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOA_SNAPSHOT_EXPORT_PATH = /^\/api\/app\/soa\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:pdf|docx)$/i;
const TASK_DETAIL_PATH = /^\/app\/tasks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_EDIT_PATH = /^\/app\/tasks\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/edit$/i;

function pathMatches(rule: WorkspacePathRule, pathname: string): boolean {
  return typeof rule.path === "string" ? rule.path === pathname : rule.path.test(pathname);
}

const sectionPolicies: Record<WorkspaceSectionId, WorkspaceSectionPolicy> = {
  assets: {
    id: "assets",
    href: "/app/assets",
    label: "Asset inventory",
    title: "Asset inventory",
    icon: "file",
    paths: [
      { path: "/app/assets", requirement: "view" },
      { path: ASSET_DETAIL_PATH, requirement: "view" },
      { path: "/app/assets/new", requirement: "manage" },
      { path: ASSET_EDIT_PATH, requirement: "manage" },
      { path: "/app/assets/import", requirement: "manage" },
      { path: "/api/app/assets/export", requirement: "manage" },
    ],
    viewRoles: new Set(["owner", "admin"]),
    navigationGroups: { owner: "Programme", admin: "Programme" },
    manageCapability: "manage_imports",
    manageDeniedMessage: "Only workspace operators can manage assets",
  },
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
  audits: {
    id: "audits",
    href: "/app/audits",
    label: "Internal audits",
    title: "Internal audits",
    icon: "shield",
    paths: [
      { path: "/app/audits", requirement: "view" },
      { path: AUDIT_DETAIL_PATH, requirement: "view" },
      { path: "/app/audits/new", requirement: "manage", title: "Plan an audit" },
      { path: AUDIT_PACK_PATH, requirement: "manage" },
      { path: AUDITOR_LINK_PATH, requirement: "manage" },
    ],
    viewRoles: new Set(["owner", "admin"]),
    navigationGroups: { owner: "Oversight", admin: "Oversight" },
    rolePresentation: {
      owner: { label: "Internal audits", title: "Internal audits", presentation: "operator" },
      admin: { label: "Internal audits", title: "Internal audits", presentation: "operator" },
      member: { label: "Internal audits", title: "Internal audits", presentation: "member" },
    },
    manageCapability: "manage_audits",
    manageDeniedMessage: "Only workspace operators can modify audits",
    operationDeniedMessages: {
      "auditor-access": "Only workspace operators can manage auditor access",
    },
  },
  "automation-setup": {
    id: "automation-setup",
    href: "/app/setup",
    label: "Automation setup",
    title: "Automation setup",
    icon: "activity",
    paths: [{ path: "/app/setup", requirement: "view" }],
    viewRoles: new Set(["owner", "admin"]),
    navigationGroups: {},
    manageCapability: "manage_automation_setup",
    manageDeniedMessage: "Only workspace owners can set up automation",
  },
  "audit-activity": {
    id: "audit-activity",
    href: "/app/activity",
    label: "Audit trail",
    title: "Audit trail",
    icon: "activity",
    paths: [{ path: "/app/activity", requirement: "view" }],
    viewRoles: new Set(["owner", "admin"]),
    navigationGroups: {},
    manageDeniedMessage: null,
  },
  evidence: {
    id: "evidence",
    href: "/app/evidence",
    label: "Evidence",
    title: "Evidence",
    icon: "file",
    paths: [
      { path: "/app/evidence", requirement: "view" },
      { path: "/app/evidence/new", requirement: "manage" },
      { path: "/api/app/evidence/export", requirement: "manage" },
    ],
    viewRoles: new Set(["owner", "admin"]),
    navigationGroups: { owner: "Work", admin: "Work" },
    manageCapability: "manage_evidence",
    manageDeniedMessage: "Only workspace operators can manage evidence",
  },
  baseline: {
    id: "baseline",
    href: "/app/baseline",
    label: "Baseline",
    title: "Baseline",
    icon: "file",
    paths: [{ path: "/app/baseline", requirement: "view" }],
    viewRoles: new Set(["owner", "admin", "member"]),
    navigationGroups: {},
    manageCapability: "manage_baselines",
    manageDeniedMessage: "Only a workspace coordinator can save a baseline.",
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
  notifications: {
    id: "notifications",
    href: "/app/notifications",
    label: "Notifications",
    title: "Notifications",
    icon: "bell",
    paths: [{ path: "/app/notifications", requirement: "view" }],
    viewRoles: new Set(["owner", "admin", "member"]),
    navigationGroups: {},
    manageDeniedMessage: null,
  },
  overview: {
    id: "overview",
    href: "/app",
    label: "Dashboard",
    title: "Dashboard",
    icon: "home",
    paths: [{ path: "/app", requirement: "view" }],
    viewRoles: new Set(["owner", "admin", "member"]),
    navigationGroups: { owner: null, admin: null, member: null },
    rolePresentation: {
      owner: { label: "Dashboard", title: "Dashboard", presentation: "operator" },
      admin: { label: "Dashboard", title: "Dashboard", presentation: "operator" },
      member: { label: "Overview", title: "Overview", presentation: "member" },
    },
    manageDeniedMessage: null,
  },
  policies: {
    id: "policies",
    href: "/app/policies",
    label: "Policies",
    title: "Policies",
    icon: "file",
    paths: [
      { path: "/app/policies", requirement: "view" },
      { path: POLICY_DETAIL_PATH, requirement: "view" },
      { path: "/app/policies/new", requirement: "manage" },
    ],
    viewRoles: new Set(["owner", "admin", "member"]),
    navigationGroups: { owner: "Programme", admin: "Programme", member: "Compliance" },
    manageCapability: "manage_policies",
    manageDeniedMessage: "Only workspace operators can manage policies",
  },
  risks: {
    id: "risks",
    href: "/app/risks",
    label: "Risk register",
    title: "Risk register",
    icon: "alert",
    paths: [
      { path: "/app/risks", requirement: "view" },
      { path: RISK_DETAIL_PATH, requirement: "view" },
      { path: "/app/risks/new", requirement: "manage" },
      { path: RISK_EDIT_PATH, requirement: "manage" },
      { path: "/app/risks/import", requirement: "manage" },
      { path: "/api/app/risks/export", requirement: "manage" },
    ],
    viewRoles: new Set(["owner", "admin"]),
    navigationGroups: { owner: "Work", admin: "Work" },
    manageCapability: "manage_risk_matrix",
    manageDeniedMessage: "Only workspace operators can update risks",
  },
  scope: {
    id: "scope",
    href: "/app/scope",
    label: "Scope & context",
    title: "Scope & context",
    icon: "file",
    paths: [{ path: "/app/scope", requirement: "view" }],
    viewRoles: new Set(["owner", "admin"]),
    navigationGroups: {},
    manageCapability: "manage_scope",
    manageDeniedMessage: "Only workspace owners can update the organisation scope",
  },
  soa: {
    id: "soa",
    href: "/app/soa",
    label: "Controls & applicability",
    title: "Controls & applicability",
    icon: "file",
    paths: [
      { path: "/app/soa", requirement: "view" },
      { path: SOA_DETAIL_PATH, requirement: "view" },
      { path: "/app/soa/import", requirement: "manage" },
      { path: "/api/app/soa/export", requirement: "manage" },
      { path: SOA_SNAPSHOT_EXPORT_PATH, requirement: "manage" },
    ],
    viewRoles: new Set(["owner", "admin", "member"]),
    navigationGroups: { owner: "Programme", admin: "Programme", member: "Compliance" },
    manageCapability: "manage_imports",
    manageDeniedMessage: "Only workspace Owners and Admins can finalise a Statement of Applicability",
  },
  tasks: {
    id: "tasks",
    href: "/app/tasks",
    label: "Tasks",
    title: "Tasks",
    icon: "check",
    paths: [
      { path: "/app/tasks", requirement: "view" },
      { path: TASK_DETAIL_PATH, requirement: "view" },
      { path: "/app/tasks/new", requirement: "manage" },
      { path: TASK_EDIT_PATH, requirement: "manage" },
      { path: "/app/tasks/from-gap", requirement: "manage" },
      { path: "/api/app/tasks/export", requirement: "manage" },
    ],
    viewRoles: new Set(["owner", "admin", "member"]),
    navigationGroups: { owner: "Work", admin: "Work", member: "Compliance" },
    rolePresentation: {
      owner: { label: "Tasks", title: "Tasks", presentation: "operator" },
      admin: { label: "Tasks", title: "Tasks", presentation: "operator" },
      member: { label: "Assigned tasks", title: "Tasks", presentation: "member", navigationHref: "/app/tasks?filter=assigned" },
    },
    manageCapability: "manage_tasks",
    manageDeniedMessage: "Only workspace operators can edit tasks",
    operationCapabilities: {
      "push-task-to-tracker": "manage_connections",
    },
    operationDeniedMessages: {
      "create-task": "Only workspace operators can create tasks",
      "edit-task": "Only workspace operators can edit tasks",
      "push-task-to-tracker": "Only workspace operators can push tracker tickets",
      "review-task-contributions": "Only a workspace coordinator can review contributions.",
      "update-task-status": "Only workspace operators can update task status",
    },
  },
  "trust-center": {
    id: "trust-center",
    href: "/app/trust",
    label: "Trust Center",
    title: "Trust Center",
    icon: "shield",
    paths: [{ path: "/app/trust", requirement: "view" }],
    viewRoles: new Set(["owner", "admin"]),
    navigationGroups: { owner: "Share", admin: "Share" },
    manageCapability: "manage_trust_center",
    manageDeniedMessage: "Only workspace operators can manage the Trust Center",
  },
};

function sectionAccess(
  policy: WorkspaceSectionPolicy,
  role: MembershipRole | null,
): WorkspaceSectionAccess {
  const canView = role !== null && policy.viewRoles.has(role);
  const canManage = role !== null
    && policy.manageCapability !== undefined
    && hasCapability(role, policy.manageCapability);
  const navigationGroup = role === null ? undefined : policy.navigationGroups[role];
  const rolePresentation = role === null ? undefined : policy.rolePresentation?.[role];
  const label = rolePresentation?.label ?? policy.label;
  const title = rolePresentation?.title ?? policy.title;
  const canManageOperation = (operation?: WorkspaceManageOperation) => {
    const capability = operation
      ? policy.operationCapabilities?.[operation] ?? policy.manageCapability
      : policy.manageCapability;
    return role !== null && capability !== undefined && hasCapability(role, capability);
  };
  return {
    id: policy.id,
    href: policy.href,
    label,
    title,
    icon: policy.icon,
    canView,
    canManage,
    navigation: navigationGroup !== undefined
      ? {
          group: navigationGroup,
          href: rolePresentation?.navigationHref ?? policy.href,
          label,
          icon: policy.icon,
        }
      : null,
    presentation: rolePresentation?.presentation ?? null,
    manageDeniedMessage: policy.manageDeniedMessage,
    canAccessPath: (pathname) => {
      const rule = policy.paths.find((candidate) => pathMatches(candidate, pathname));
      if (!rule) return false;
      return rule.requirement === "manage" ? canManage : canView;
    },
    titleForPath: (pathname) => {
      const rule = policy.paths.find((candidate) => pathMatches(candidate, pathname));
      return rule ? rule.title ?? title : null;
    },
    canManageOperation,
    manageDeniedMessageFor: (operation) => operation
      ? policy.operationDeniedMessages?.[operation] ?? policy.manageDeniedMessage ?? "Workspace management access is unavailable"
      : policy.manageDeniedMessage ?? "Workspace management access is unavailable",
    requireManage: (operation) => {
      const deniedMessage = operation
        ? policy.operationDeniedMessages?.[operation] ?? policy.manageDeniedMessage
        : policy.manageDeniedMessage;
      if (!canManageOperation(operation)) throw new Error(deniedMessage ?? "Workspace management access is unavailable");
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
