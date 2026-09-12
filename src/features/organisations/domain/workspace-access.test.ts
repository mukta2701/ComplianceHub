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
