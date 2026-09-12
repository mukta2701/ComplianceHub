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
