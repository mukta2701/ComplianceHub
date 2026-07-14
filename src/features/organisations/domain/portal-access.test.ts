import { describe, expect, it } from "vitest";
import { workspaceRequestAccess } from "./portal-access";

const POLICY_ID = "51000000-0000-4000-8000-000000000001";

describe("workspace portal route access", () => {
  it.each(["owner", "admin"] as const)("allows %s operators throughout the app and app API", (role) => {
    expect(workspaceRequestAccess("/app/settings", { authenticated: true, role })).toBe("allow");
    expect(workspaceRequestAccess("/app/policies/new", { authenticated: true, role })).toBe("allow");
    expect(workspaceRequestAccess("/api/app/tasks/export", { authenticated: true, role })).toBe("allow");
  });

  it.each([
    "/app",
    "/app/policies",
    `/app/policies/${POLICY_ID}`,
    "/app/monitoring",
    "/app/frameworks",
    "/app/reports/readiness",
    "/app/notifications",
  ])("allows a Member to open the curated route %s", (pathname) => {
    expect(workspaceRequestAccess(pathname, { authenticated: true, role: "member" })).toBe("allow");
  });

  it.each([
    "/app/settings",
    "/app/integrations",
    "/app/tasks",
    "/app/policies/new",
    "/app/policies/not-a-policy-id",
    `/app/policies/${POLICY_ID}/edit`,
    "/app/policies-evil",
    "/app/monitoring/connections",
    "/app/reports/readiness/history",
  ])("redirects a Member away from the non-curated app route %s", (pathname) => {
    expect(workspaceRequestAccess(pathname, { authenticated: true, role: "member" })).toBe("redirect-member-home");
  });

  it("allows only the readiness PDF in the app API for Members", () => {
    expect(workspaceRequestAccess("/api/app/reports/readiness/pdf", { authenticated: true, role: "member" })).toBe("allow");
    expect(workspaceRequestAccess("/api/app/tasks/export", { authenticated: true, role: "member" })).toBe("forbidden");
    expect(workspaceRequestAccess("/api/app/reports/readiness/pdf-extra", { authenticated: true, role: "member" })).toBe("forbidden");
  });

  it("does not broaden Member access beyond the Framework Coverage read page", () => {
    expect(workspaceRequestAccess("/app/frameworks", { authenticated: true, role: "member" })).toBe("allow");
    expect(workspaceRequestAccess("/app/soa", { authenticated: true, role: "member" })).toBe("redirect-member-home");
    expect(workspaceRequestAccess("/app/settings", { authenticated: true, role: "member" })).toBe("redirect-member-home");
    expect(workspaceRequestAccess("/app/integrations", { authenticated: true, role: "member" })).toBe("redirect-member-home");
  });

  it("reserves onboarding for authenticated users without a membership", () => {
    expect(workspaceRequestAccess("/app/onboarding", { authenticated: true, role: null })).toBe("allow");
    expect(workspaceRequestAccess("/app/onboarding", { authenticated: true, role: "member" })).toBe("redirect-member-home");
    expect(workspaceRequestAccess("/app/onboarding", { authenticated: true, role: "admin" })).toBe("redirect-member-home");
  });

  it("keeps page and API authentication failures distinct", () => {
    expect(workspaceRequestAccess("/app", { authenticated: false, role: null })).toBe("redirect-sign-in");
    expect(workspaceRequestAccess("/api/app/tasks/export", { authenticated: false, role: null })).toBe("unauthorized");
    expect(workspaceRequestAccess("/app/policies", { authenticated: true, role: null })).toBe("redirect-onboarding");
    expect(workspaceRequestAccess("/api/app/reports/readiness/pdf", { authenticated: true, role: null })).toBe("forbidden");
  });
});
