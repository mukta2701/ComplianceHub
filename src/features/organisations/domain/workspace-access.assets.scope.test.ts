import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const gatedSources = [
  "src/app/app/assets/actions.ts",
  "src/app/app/assets/page.tsx",
  "src/app/app/assets/[id]/page.tsx",
  "src/app/app/assets/new/page.tsx",
  "src/app/app/assets/[id]/edit/page.tsx",
  "src/app/app/assets/import/page.tsx",
];

describe("Asset inventory shared access seam", () => {
  it.each(gatedSources)("routes %s through the Workspace access module", (filename) => {
    const source = readFileSync(resolve(process.cwd(), filename), "utf8");

    expect(source).toContain("workspaceAccess");
    expect(source).toContain('.section("assets")');
    expect(source).not.toMatch(/membership\.role\s*(?:===|!==)\s*["'](?:member|owner|admin)["']/);
    expect(source).not.toContain('hasCapability(membership.role, "manage_imports")');
  });

  it("routes asset-import action checks through the Asset-inventory section", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/app/imports/actions.ts"), "utf8");

    expect(source).toContain('workspaceAccess(membership.role).section("assets").canManage');
  });

  it("sources operator Asset navigation from the Asset-inventory section", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/app-shell.tsx"), "utf8");

    expect(source).toContain('workspaceAccess("owner").section("assets").navigation');
    expect(source).not.toContain('["/app/assets", "file", "Asset inventory"]');
  });
});
