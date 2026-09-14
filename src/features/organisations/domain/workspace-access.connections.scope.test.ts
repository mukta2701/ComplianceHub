import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Connections workspace-access ownership", () => {
  it.each([
    "src/app/app/integrations/page.tsx",
    "src/app/app/integrations/actions.ts",
    "src/app/app/integrations/jira/actions.ts",
    "src/app/api/github/setup/route.ts",
    "src/app/api/github/callback/route.ts",
    "src/app/api/integrations/jira/connect/route.ts",
    "src/app/api/integrations/jira/callback/route.ts",
    "src/features/integrations/application/authorization-state.ts",
  ])("routes Connections role decisions in %s through the shared section", (relativePath) => {
    const contents = source(relativePath);

    expect(contents).toContain("workspaceAccess");
    expect(contents).toContain('.section("connections")');
    expect(contents).not.toContain("hasCapability");
  });

  it.each([
    "src/app/app/integrations/page.tsx",
    "src/app/app/integrations/actions.ts",
    "src/app/app/integrations/jira/actions.ts",
    "src/app/api/github/setup/route.ts",
    "src/app/api/github/callback/route.ts",
    "src/app/api/integrations/jira/connect/route.ts",
    "src/app/api/integrations/jira/callback/route.ts",
  ])("does not leave a section-specific role comparison in %s", (relativePath) => {
    expect(source(relativePath)).not.toMatch(/membership(?:\?|)\.role\s*(?:===|!==)/);
  });

  it("sources the Connections title from workspace access while keeping it out of the sidebar", () => {
    const shell = source("src/components/app-shell.tsx");
    const connectionsPage = source("src/app/app/integrations/page.tsx");
    const settingsPage = source("src/app/app/settings/page.tsx");

    expect(shell).toContain('workspaceAccess("owner").section("connections")');
    expect(shell).not.toContain('["/app/integrations", "Connections"]');
    expect(connectionsPage).toContain("connectionsAccess.href");
    expect(connectionsPage).toContain("connectionsAccess.label");
    expect(settingsPage).toContain('workspaceAccess("owner").section("connections")');
    expect(settingsPage).not.toContain('{ href: "/app/integrations", label: "Connections" }');
  });

  it.each([
    "src/app/api/github/webhook/route.ts",
    "src/app/api/cron/integrations/route.ts",
    "src/app/api/cron/integrations-sync/route.ts",
    "src/app/api/cron/github-collect/route.ts",
  ])("keeps provider and scheduler authorization in %s outside Workspace membership policy", (relativePath) => {
    expect(source(relativePath)).not.toContain("workspaceAccess");
  });
});
