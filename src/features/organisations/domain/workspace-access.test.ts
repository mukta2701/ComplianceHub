import { describe, expect, it } from "vitest";
import { workspaceAccess } from "./workspace-access";

describe("Notifications workspace access", () => {
  it.each(["owner", "admin", "member"] as const)(
    "keeps the personal Notifications inbox available to %ss without adding sidebar navigation",
    (role) => {
      const notifications = workspaceAccess(role).section("notifications");

      expect(notifications).toMatchObject({
        id: "notifications",
        href: "/app/notifications",
        label: "Notifications",
        title: "Notifications",
        icon: "bell",
        canView: true,
        canManage: false,
        navigation: null,
        manageDeniedMessage: null,
      });
      expect(notifications.canAccessPath("/app/notifications")).toBe(true);
    },
  );

  it("does not grant Notifications access before Workspace membership exists", () => {
    const notifications = workspaceAccess(null).section("notifications");

    expect(notifications.canView).toBe(false);
    expect(notifications.canManage).toBe(false);
    expect(notifications.navigation).toBeNull();
    expect(notifications.canAccessPath("/app/notifications")).toBe(false);
  });

  it("does not match nested Notifications routes", () => {
    expect(workspaceAccess("member").sectionForPath("/app/notifications/extra")).toBeNull();
  });
});

describe("Trust Center workspace access", () => {
  it.each(["owner", "admin"] as const)(
    "keeps Trust Center management and Share navigation available to %ss",
    (role) => {
      const trustCenter = workspaceAccess(role).section("trust-center");

      expect(trustCenter).toMatchObject({
        id: "trust-center",
        href: "/app/trust",
        label: "Trust Center",
        title: "Trust Center",
        icon: "shield",
        canView: true,
        canManage: true,
        navigation: {
          group: "Share",
          href: "/app/trust",
          label: "Trust Center",
          icon: "shield",
        },
        manageDeniedMessage: "Only workspace operators can manage the Trust Center",
      });
      expect(trustCenter.canAccessPath("/app/trust")).toBe(true);
      expect(() => trustCenter.requireManage()).not.toThrow();
    },
  );

  it.each(["member", null] as const)("does not grant private Trust Center access to %s", (role) => {
    const trustCenter = workspaceAccess(role).section("trust-center");

    expect(trustCenter.canView).toBe(false);
    expect(trustCenter.canManage).toBe(false);
    expect(trustCenter.navigation).toBeNull();
    expect(trustCenter.canAccessPath("/app/trust")).toBe(false);
    expect(() => trustCenter.requireManage()).toThrow(
      "Only workspace operators can manage the Trust Center",
    );
  });

  it("keeps public and nested Trust Center routes outside the private section", () => {
    const access = workspaceAccess("owner");

    expect(access.sectionForPath("/trust/example")).toBeNull();
    expect(access.sectionForPath("/app/trust/extra")).toBeNull();
  });
});

describe("Saved baseline workspace access", () => {
  it("keeps the saved baseline visible and read-only for Members", () => {
    const access = workspaceAccess("member");
    const baseline = access.section("baseline");

    expect(baseline).toMatchObject({
      id: "baseline",
      href: "/app/baseline",
      label: "Baseline",
      title: "Baseline",
      icon: "file",
      canView: true,
      canManage: false,
      navigation: null,
      manageDeniedMessage: "Only a workspace coordinator can save a baseline.",
    });
    expect(access.sectionForPath("/app/baseline")?.canAccessPath("/app/baseline")).toBe(true);
    expect(access.sectionForPath("/app/baseline/edit")).toBeNull();
    expect(() => baseline.requireManage()).toThrow(
      "Only a workspace coordinator can save a baseline.",
    );
  });

  it.each(["owner", "admin"] as const)(
    "keeps saved-baseline management available to %ss without adding navigation",
    (role) => {
      const baseline = workspaceAccess(role).section("baseline");

      expect(baseline.canView).toBe(true);
      expect(baseline.canManage).toBe(true);
      expect(baseline.navigation).toBeNull();
      expect(() => baseline.requireManage()).not.toThrow();
    },
  );

  it("does not grant saved-baseline access before Workspace membership exists", () => {
    const baseline = workspaceAccess(null).section("baseline");

    expect(baseline.canView).toBe(false);
    expect(baseline.canManage).toBe(false);
    expect(baseline.navigation).toBeNull();
    expect(baseline.canAccessPath("/app/baseline")).toBe(false);
  });
});

describe("Scope and context workspace access", () => {
  it("keeps Scope & context viewable and manageable only by an Owner", () => {
    const access = workspaceAccess("owner");
    const scope = access.section("scope");

    expect(scope).toMatchObject({
      id: "scope",
      href: "/app/scope",
      label: "Scope & context",
      title: "Scope & context",
      icon: "file",
      canView: true,
      canManage: true,
      navigation: null,
      manageDeniedMessage: "Only workspace owners can update the organisation scope",
    });
    expect(scope.canAccessPath("/app/scope")).toBe(true);
    expect(access.sectionForPath("/app/scope/edit")).toBeNull();
    expect(() => scope.requireManage()).not.toThrow();
  });

  it("keeps Scope & context visible but read-only for Admins", () => {
    const scope = workspaceAccess("admin").section("scope");

    expect(scope.canView).toBe(true);
    expect(scope.canManage).toBe(false);
    expect(scope.navigation).toBeNull();
    expect(scope.canAccessPath("/app/scope")).toBe(true);
    expect(() => scope.requireManage()).toThrow(
      "Only workspace owners can update the organisation scope",
    );
  });

  it.each(["member", null] as const)(
    "does not grant Scope & context access to %s",
    (role) => {
      const scope = workspaceAccess(role).section("scope");

      expect(scope.canView).toBe(false);
      expect(scope.canManage).toBe(false);
      expect(scope.navigation).toBeNull();
      expect(scope.canAccessPath("/app/scope")).toBe(false);
    },
  );
});

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

describe("Statement of Applicability workspace access", () => {
  const registerId = "56000000-0000-4000-8000-000000000001";
  const snapshotId = "56000000-0000-4000-8000-000000000002";

  it("keeps control reviews visible and read-only for Members", () => {
    const access = workspaceAccess("member");
    const soa = access.section("soa");

    expect(soa).toMatchObject({
      id: "soa",
      href: "/app/soa",
      label: "Controls & applicability",
      title: "Controls & applicability",
      icon: "file",
      canView: true,
      canManage: false,
      navigation: {
        group: "Compliance",
        href: "/app/soa",
        label: "Controls & applicability",
        icon: "file",
      },
      manageDeniedMessage: "Only workspace Owners and Admins can finalise a Statement of Applicability",
    });
    expect(access.sectionForPath("/app/soa")?.canAccessPath("/app/soa")).toBe(true);
    expect(access.sectionForPath(`/app/soa/${registerId}`)?.canAccessPath(`/app/soa/${registerId}`)).toBe(true);
    for (const pathname of [
      "/app/soa/import",
      "/api/app/soa/export",
      `/api/app/soa/${snapshotId}/pdf`,
      `/api/app/soa/${snapshotId}/docx`,
    ]) {
      expect(access.sectionForPath(pathname)?.id).toBe("soa");
      expect(access.sectionForPath(pathname)?.canAccessPath(pathname)).toBe(false);
    }
    expect(access.sectionForPath("/app/soa/not-a-register-id")).toBeNull();
    expect(access.sectionForPath(`/app/soa/${registerId}/history`)).toBeNull();
    expect(access.sectionForPath(`/api/app/soa/${snapshotId}/txt`)).toBeNull();
    expect(() => soa.requireManage()).toThrow(
      "Only workspace Owners and Admins can finalise a Statement of Applicability",
    );
  });

  it.each(["owner", "admin"] as const)(
    "keeps SoA management and Programme navigation available to %ss",
    (role) => {
      const access = workspaceAccess(role);
      const soa = access.section("soa");

      expect(soa).toMatchObject({
        canView: true,
        canManage: true,
        navigation: {
          group: "Programme",
          href: "/app/soa",
          label: "Controls & applicability",
          icon: "file",
        },
      });
      expect(access.sectionForPath("/app/soa/import")?.canAccessPath("/app/soa/import")).toBe(true);
      expect(access.sectionForPath("/api/app/soa/export")?.canAccessPath("/api/app/soa/export")).toBe(true);
      expect(access.sectionForPath(`/api/app/soa/${snapshotId}/pdf`)?.canAccessPath(`/api/app/soa/${snapshotId}/pdf`)).toBe(true);
      expect(() => soa.requireManage()).not.toThrow();
    },
  );

  it("does not grant SoA access before Workspace membership exists", () => {
    const soa = workspaceAccess(null).section("soa");

    expect(soa).toMatchObject({
      canView: false,
      canManage: false,
      navigation: null,
    });
    expect(soa.canAccessPath("/app/soa")).toBe(false);
    expect(soa.canAccessPath("/app/soa/import")).toBe(false);
  });
});
