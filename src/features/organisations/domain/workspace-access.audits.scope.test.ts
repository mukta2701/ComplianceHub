import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Audit workspace-access ownership", () => {
  it.each([
    "src/app/app/audits/page.tsx",
    "src/app/app/audits/[id]/page.tsx",
    "src/app/app/audits/new/page.tsx",
    "src/app/app/audits/actions.ts",
    "src/app/app/audits/[id]/share-actions.ts",
    "src/app/api/app/audits/[id]/auditor-link/route.ts",
  ])("routes Audit role decisions in %s through the shared section", (relativePath) => {
    const contents = source(relativePath);

    expect(contents).toContain("workspaceAccess");
    expect(contents).toContain('.section("audits")');
    expect(contents).not.toMatch(/membership(?:\?|)\.role\s*(?:===|!==)/);
  });

  it("sources Audit navigation and route-specific titles from workspace access", () => {
    const contents = source("src/components/app-shell.tsx");

    expect(contents).toContain('workspaceAccess("owner").section("audits").navigation');
    expect(contents).toContain('workspaceAccess("owner").section("audit-activity")');
    expect(contents).not.toContain('["/app/audits", "shield", "Internal audits"]');
    expect(contents).not.toContain('["/app/activity", "Audit trail"]');
    expect(contents).not.toContain('["/app/audits/new", "Plan an audit"]');
  });

  it.each([
    "src/app/app/audits/page.tsx",
    "src/app/app/activity/page.tsx",
  ])("sources Audit tabs in %s from workspace access", (relativePath) => {
    const contents = source(relativePath);

    expect(contents).toContain("workspaceAccess");
    expect(contents).not.toContain('{ href: "/app/audits", label: "Internal audits" }');
    expect(contents).not.toContain('{ href: "/app/activity", label: "Audit trail" }');
  });

  it("does not add a local role gate to the existing Audit-pack export", () => {
    const contents = source("src/app/api/app/audits/[id]/pack/route.ts");

    expect(contents).not.toContain("workspaceAccess");
    expect(contents).not.toContain("hasCapability");
  });

  it("keeps public auditor-token access outside Workspace membership policy", () => {
    const contents = source("src/app/audit-view/[token]/page.tsx");

    expect(contents).not.toContain("workspaceAccess");
  });
});
