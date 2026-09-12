import { describe, expect, it } from "vitest";
import { workspaceAccess } from "./workspace-access";

describe("Framework coverage workspace access", () => {
  it("keeps Framework coverage visible and read-only for Members", () => {
    const access = workspaceAccess("member");
    const frameworks = access.section("frameworks");

    expect(frameworks).toMatchObject({
      id: "frameworks",
      href: "/app/frameworks",
      label: "Framework coverage",
      title: "Framework coverage",
      icon: "file",
      canView: true,
      canManage: false,
      navigation: {
        group: "Compliance",
        href: "/app/frameworks",
        label: "Framework coverage",
        icon: "file",
      },
    });
    expect(access.sectionForPath("/app/frameworks")?.id).toBe("frameworks");
    expect(access.sectionForPath("/app/frameworks/extra")).toBeNull();
    expect(() => frameworks.requireManage()).toThrow(
      "Only workspace operators can manage framework mappings",
    );
  });

  it.each(["owner", "admin"] as const)(
    "keeps Framework coverage management available to %ss without adding an operator navigation link",
    (role) => {
      const frameworks = workspaceAccess(role).section("frameworks");

      expect(frameworks.canView).toBe(true);
      expect(frameworks.canManage).toBe(true);
      expect(frameworks.navigation).toBeNull();
      expect(() => frameworks.requireManage()).not.toThrow();
    },
  );

  it("does not grant Framework coverage access before Workspace membership exists", () => {
    const frameworks = workspaceAccess(null).section("frameworks");

    expect(frameworks.canView).toBe(false);
    expect(frameworks.canManage).toBe(false);
    expect(frameworks.navigation).toBeNull();
  });
});

describe("Leadership report workspace access", () => {
  it("keeps the published Leadership report and PDF visible but not manageable for Members", () => {
    const access = workspaceAccess("member");
    const leadershipReport = access.sectionForPath("/app/reports/readiness");

    expect(leadershipReport).toMatchObject({
      id: "leadership-report",
      href: "/app/reports/readiness",
      label: "Leadership report",
      title: "Leadership report",
      icon: "file",
      canView: true,
      canManage: false,
      navigation: {
        group: null,
        href: "/app/reports/readiness",
        label: "Leadership report",
        icon: "file",
      },
    });
    expect(access.sectionForPath("/api/app/reports/readiness/pdf")?.id).toBe("leadership-report");
    expect(access.sectionForPath("/app/reports/readiness/history")).toBeNull();
    expect(access.sectionForPath("/api/app/reports/readiness/pdf-extra")).toBeNull();
    expect(() => leadershipReport?.requireManage()).toThrow(
      "Only workspace operators can publish leadership reports",
    );
  });

  it.each(["owner", "admin"] as const)(
    "keeps live Leadership report management and Share navigation available to %ss",
    (role) => {
      const leadershipReport = workspaceAccess(role).sectionForPath("/app/reports/readiness");

      expect(leadershipReport).toMatchObject({
        canView: true,
        canManage: true,
        navigation: {
          group: "Share",
          href: "/app/reports/readiness",
          label: "Leadership report",
          icon: "file",
        },
      });
      expect(() => leadershipReport?.requireManage()).not.toThrow();
    },
  );

  it("does not grant Leadership report access before Workspace membership exists", () => {
    const leadershipReport = workspaceAccess(null).sectionForPath("/app/reports/readiness");

    expect(leadershipReport).toMatchObject({
      canView: false,
      canManage: false,
      navigation: null,
    });
  });
});

describe("Readiness assessment workspace access", () => {
  const assessmentId = "52000000-0000-4000-8000-000000000001";

  it("keeps assessment pages visible but read-only and absent from Member navigation", () => {
    const access = workspaceAccess("member");
    const assessments = access.section("assessments");

    expect(assessments).toMatchObject({
      id: "assessments",
      href: "/app/assessment",
      label: "Gap assessment",
      title: "Gap assessment",
      icon: "clipboard",
      canView: true,
      canManage: false,
      navigation: null,
      manageDeniedMessage: "Only workspace operators can complete assessments.",
    });
    expect(access.sectionForPath("/app/assessment")?.canAccessPath("/app/assessment")).toBe(true);
    expect(access.sectionForPath(`/app/assessment/${assessmentId}`)?.canAccessPath(`/app/assessment/${assessmentId}`)).toBe(true);
    expect(access.sectionForPath("/api/app/assessment/complete")?.canAccessPath("/api/app/assessment/complete")).toBe(false);
    expect(access.sectionForPath("/app/assessment/not-an-assessment-id")).toBeNull();
    expect(access.sectionForPath(`/app/assessment/${assessmentId}/edit`)).toBeNull();
  });

  it.each(["owner", "admin"] as const)(
    "keeps assessment management and Programme navigation available to %ss",
    (role) => {
      const access = workspaceAccess(role);
      const assessments = access.section("assessments");

      expect(assessments).toMatchObject({
        canView: true,
        canManage: true,
        navigation: {
          group: "Programme",
          href: "/app/assessment",
          label: "Gap assessment",
          icon: "clipboard",
        },
      });
      expect(access.sectionForPath("/api/app/assessment/complete")?.canAccessPath("/api/app/assessment/complete")).toBe(true);
      expect(() => assessments.requireManage()).not.toThrow();
    },
  );

  it("does not grant assessment access before Workspace membership exists", () => {
    const assessments = workspaceAccess(null).section("assessments");

    expect(assessments).toMatchObject({
      canView: false,
      canManage: false,
      navigation: null,
    });
    expect(assessments.canAccessPath("/app/assessment")).toBe(false);
    expect(assessments.canAccessPath("/api/app/assessment/complete")).toBe(false);
  });
});
