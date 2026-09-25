import type { MembershipRole } from "./access";
import { workspaceAccess } from "./workspace-access";

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

function normalisePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
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
  if (pathname === "/app/organisations/new") {
    return identity.role === "owner" ? "allow" : "redirect-member-home";
  }
  if (identity.role === "owner" || identity.role === "admin") return "allow";

  const section = workspaceAccess(identity.role).sectionForPath(pathname);
  if (section) return section.canAccessPath(pathname) ? "allow" : isApi ? "forbidden" : "redirect-member-home";
  if (isApi) return "forbidden";
  return "redirect-member-home";
}
