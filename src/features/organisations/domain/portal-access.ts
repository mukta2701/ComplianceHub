import type { MembershipRole } from "./access";

export type WorkspaceAccessDecision =
  | "allow"
  | "redirect-sign-in"
  | "redirect-onboarding"
  | "redirect-member-home"
  | "unauthorized"
  | "forbidden";

type WorkspaceIdentity = {
  authenticated: boolean;
  role: MembershipRole | null;
};

const POLICY_DETAIL_PATH = /^\/app\/policies\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MEMBER_APP_PATHS = new Set([
  "/app",
  "/app/policies",
  "/app/monitoring",
  "/app/frameworks",
  "/app/reports/readiness",
  "/app/notifications",
]);

const MEMBER_API_PATHS = new Set([
  "/api/app/reports/readiness/pdf",
]);

function normalisePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function isMemberAppPath(pathname: string): boolean {
  return MEMBER_APP_PATHS.has(pathname) || POLICY_DETAIL_PATH.test(pathname);
}

export function workspaceRequestAccess(
  rawPathname: string,
  identity: WorkspaceIdentity,
): WorkspaceAccessDecision {
  const pathname = normalisePath(rawPathname);
  const isApi = pathname === "/api/app" || pathname.startsWith("/api/app/");
  const isApp = pathname === "/app" || pathname.startsWith("/app/");

  if (!isApi && !isApp) return "allow";
  if (!identity.authenticated) return isApi ? "unauthorized" : "redirect-sign-in";

  if (!identity.role) {
    if (pathname === "/app/onboarding") return "allow";
    return isApi ? "forbidden" : "redirect-onboarding";
  }

  if (pathname === "/app/onboarding") return "redirect-member-home";
  if (identity.role === "owner" || identity.role === "admin") return "allow";

  if (isApi) return MEMBER_API_PATHS.has(pathname) ? "allow" : "forbidden";
  return isMemberAppPath(pathname) ? "allow" : "redirect-member-home";
}
