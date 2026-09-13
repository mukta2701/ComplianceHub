import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("Notifications workspace-access ownership", () => {
  it("removes Notifications from the legacy Member path list", () => {
    const contents = source("src/features/organisations/domain/portal-access.ts");

    expect(contents).not.toMatch(/MEMBER_APP_PATHS[\s\S]*?"\/app\/notifications"/);
  });

  it("sources the header bell and page title metadata from workspace access", () => {
    const contents = source("src/components/app-shell.tsx");

    expect(contents).toContain('workspaceAccess("owner").section("notifications")');
    expect(contents).not.toContain('["/app/notifications", "Notifications"]');
    expect(contents).not.toMatch(/<Link href="\/app\/notifications"/);
  });

  it("does not invent a new role gate in personal notification actions", () => {
    const contents = source("src/app/app/notifications/actions.ts");

    expect(contents).not.toContain("workspaceAccess");
    expect(contents).not.toContain("hasCapability");
  });
});
