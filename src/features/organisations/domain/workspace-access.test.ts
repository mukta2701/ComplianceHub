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

describe("Risk register workspace access", () => {
  const riskId = "53000000-0000-4000-8000-000000000001";

  it("keeps the Risk register and all of its routes unavailable to Members", () => {
    const access = workspaceAccess("member");
    const risks = access.section("risks");

    expect(risks).toMatchObject({
      id: "risks",
      href: "/app/risks",
      label: "Risk register",
      title: "Risk register",
      icon: "alert",
      canView: false,
      canManage: false,
      navigation: null,
    });
    for (const pathname of [
      "/app/risks",
      `/app/risks/${riskId}`,
      "/app/risks/new",
      `/app/risks/${riskId}/edit`,
      "/app/risks/import",
      "/api/app/risks/export",
    ]) {
      expect(access.sectionForPath(pathname)?.id).toBe("risks");
      expect(access.sectionForPath(pathname)?.canAccessPath(pathname)).toBe(false);
    }
    expect(access.sectionForPath("/app/risks/not-a-risk-id")).toBeNull();
    expect(access.sectionForPath(`/app/risks/${riskId}/history`)).toBeNull();
    expect(access.sectionForPath("/api/app/risks/export-extra")).toBeNull();
  });

  it.each(["owner", "admin"] as const)(
    "keeps Risk-register access, management and Work navigation available to %ss",
    (role) => {
      const access = workspaceAccess(role);
      const risks = access.section("risks");

      expect(risks).toMatchObject({
        canView: true,
        canManage: true,
        navigation: {
          group: "Work",
          href: "/app/risks",
          label: "Risk register",
          icon: "alert",
        },
      });
      expect(access.sectionForPath(`/app/risks/${riskId}`)?.canAccessPath(`/app/risks/${riskId}`)).toBe(true);
      expect(access.sectionForPath(`/app/risks/${riskId}/edit`)?.canAccessPath(`/app/risks/${riskId}/edit`)).toBe(true);
      expect(access.sectionForPath("/api/app/risks/export")?.canAccessPath("/api/app/risks/export")).toBe(true);
    },
  );

  it("does not grant Risk-register access before Workspace membership exists", () => {
    const risks = workspaceAccess(null).section("risks");

    expect(risks).toMatchObject({
      canView: false,
      canManage: false,
      navigation: null,
    });
  });
});

describe("Asset inventory workspace access", () => {
  const assetId = "54000000-0000-4000-8000-000000000001";

  it("keeps the Asset inventory and all of its routes unavailable to Members", () => {
    const access = workspaceAccess("member");
    const assets = access.section("assets");

    expect(assets).toMatchObject({
      id: "assets",
      href: "/app/assets",
      label: "Asset inventory",
      title: "Asset inventory",
      icon: "file",
      canView: false,
      canManage: false,
      navigation: null,
      manageDeniedMessage: "Only workspace operators can manage assets",
    });
    for (const pathname of [
      "/app/assets",
      `/app/assets/${assetId}`,
      "/app/assets/new",
      `/app/assets/${assetId}/edit`,
      "/app/assets/import",
      "/api/app/assets/export",
    ]) {
      expect(access.sectionForPath(pathname)?.id).toBe("assets");
      expect(access.sectionForPath(pathname)?.canAccessPath(pathname)).toBe(false);
    }
    expect(access.sectionForPath("/app/assets/not-an-asset-id")).toBeNull();
    expect(access.sectionForPath(`/app/assets/${assetId}/history`)).toBeNull();
    expect(access.sectionForPath("/api/app/assets/export-extra")).toBeNull();
    expect(() => assets.requireManage()).toThrow("Only workspace operators can manage assets");
  });

  it.each(["owner", "admin"] as const)(
    "keeps Asset-inventory access, management and Programme navigation available to %ss",
    (role) => {
      const access = workspaceAccess(role);
      const assets = access.section("assets");

      expect(assets).toMatchObject({
        canView: true,
        canManage: true,
        navigation: {
          group: "Programme",
          href: "/app/assets",
          label: "Asset inventory",
          icon: "file",
        },
      });
      expect(access.sectionForPath(`/app/assets/${assetId}`)?.canAccessPath(`/app/assets/${assetId}`)).toBe(true);
      expect(access.sectionForPath(`/app/assets/${assetId}/edit`)?.canAccessPath(`/app/assets/${assetId}/edit`)).toBe(true);
      expect(access.sectionForPath("/api/app/assets/export")?.canAccessPath("/api/app/assets/export")).toBe(true);
      expect(() => assets.requireManage()).not.toThrow();
    },
  );

  it("does not grant Asset-inventory access before Workspace membership exists", () => {
    const assets = workspaceAccess(null).section("assets");

    expect(assets).toMatchObject({
      canView: false,
      canManage: false,
      navigation: null,
    });
  });
});

describe("Policy library workspace access", () => {
  const policyId = "55000000-0000-4000-8000-000000000001";

  it("keeps policy reading and Compliance navigation available to Members without management access", () => {
    const access = workspaceAccess("member");
    const policies = access.section("policies");

    expect(policies).toMatchObject({
      id: "policies",
      href: "/app/policies",
      label: "Policies",
      title: "Policies",
      icon: "file",
      canView: true,
      canManage: false,
      navigation: {
        group: "Compliance",
        href: "/app/policies",
        label: "Policies",
        icon: "file",
      },
      manageDeniedMessage: "Only workspace operators can manage policies",
    });
    expect(access.sectionForPath("/app/policies")?.canAccessPath("/app/policies")).toBe(true);
    expect(access.sectionForPath(`/app/policies/${policyId}`)?.canAccessPath(`/app/policies/${policyId}`)).toBe(true);
    expect(access.sectionForPath("/app/policies/new")?.canAccessPath("/app/policies/new")).toBe(false);
    expect(access.sectionForPath("/app/policies/not-a-policy-id")).toBeNull();
    expect(access.sectionForPath(`/app/policies/${policyId}/edit`)).toBeNull();
    expect(() => policies.requireManage()).toThrow("Only workspace operators can manage policies");
  });

  it.each(["owner", "admin"] as const)(
    "keeps policy reading, management and Programme navigation available to %ss",
    (role) => {
      const access = workspaceAccess(role);
      const policies = access.section("policies");

      expect(policies).toMatchObject({
        canView: true,
        canManage: true,
        navigation: {
          group: "Programme",
          href: "/app/policies",
          label: "Policies",
          icon: "file",
        },
      });
      expect(access.sectionForPath(`/app/policies/${policyId}`)?.canAccessPath(`/app/policies/${policyId}`)).toBe(true);
      expect(access.sectionForPath("/app/policies/new")?.canAccessPath("/app/policies/new")).toBe(true);
      expect(() => policies.requireManage()).not.toThrow();
    },
  );

  it("does not grant policy access before Workspace membership exists", () => {
    const policies = workspaceAccess(null).section("policies");

    expect(policies).toMatchObject({
      canView: false,
      canManage: false,
      navigation: null,
    });
    expect(policies.canAccessPath("/app/policies")).toBe(false);
  });
});
