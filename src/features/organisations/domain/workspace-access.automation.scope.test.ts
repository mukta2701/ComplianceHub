import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Automation setup workspace-access ownership", () => {
  it.each([
    "src/app/app/setup/page.tsx",
    "src/app/app/setup/actions.ts",
  ])("routes Automation setup role decisions in %s through the shared section", (relativePath) => {
    const contents = source(relativePath);

    expect(contents).toContain("workspaceAccess");
    expect(contents).toContain('.section("automation-setup")');
    expect(contents).not.toMatch(/membership(?:\?|)\.role\s*(?:===|!==)/);
  });

  it("sources the Automation setup title from workspace access", () => {
    const contents = source("src/components/app-shell.tsx");

    expect(contents).toContain('workspaceAccess("owner").section("automation-setup")');
    expect(contents).not.toContain('["/app/setup", "Automation setup"]');
  });

  it("does not pull the contradictory Automation inbox actions into the setup policy", () => {
    const contents = source("src/app/app/automation/actions.ts");

    expect(contents).not.toContain('.section("automation-setup")');
  });

  it.each([
    "src/app/api/cron/daily/route.ts",
    "src/app/api/cron/integrations-sync/route.ts",
    "src/app/api/cron/automation-purge/route.ts",
  ])("keeps cron authorization in %s outside Workspace membership policy", (relativePath) => {
    expect(source(relativePath)).not.toContain("workspaceAccess");
  });
});
