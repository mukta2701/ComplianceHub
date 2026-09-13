import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const gatedSources = [
  "src/features/risks/application/actions.ts",
  "src/app/app/risks/edit-actions.ts",
  "src/app/app/risks/config-actions.ts",
  "src/app/app/risks/rtp-actions.ts",
  "src/app/app/risks/page.tsx",
  "src/app/app/risks/[id]/page.tsx",
  "src/app/app/risks/new/page.tsx",
  "src/app/app/risks/[id]/edit/page.tsx",
  "src/app/app/risks/import/page.tsx",
];

describe("Risk register shared access seam", () => {
  it.each(gatedSources)("routes %s through the Workspace access module", (filename) => {
    const source = readFileSync(resolve(process.cwd(), filename), "utf8");

    expect(source).toContain("workspaceAccess");
    expect(source).toContain('.section("risks")');
    expect(source).not.toMatch(/membership\.role\s*(?:===|!==)\s*["'](?:member|owner|admin)["']/);
    expect(source).not.toContain('hasCapability(membership.role, "manage_risk_matrix")');
    expect(source).not.toContain('hasCapability(membership.role, "manage_imports")');
  });

  it("routes risk-import action checks through the Risk-register section", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/app/imports/actions.ts"), "utf8");

    expect(source).toContain('workspaceAccess(membership.role).section("risks").canManage');
  });
});
