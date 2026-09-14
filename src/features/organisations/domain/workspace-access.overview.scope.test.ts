import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Overview workspace-access ownership", () => {
  it("removes the app root from the legacy Member path list", () => {
    const contents = source("src/features/organisations/domain/portal-access.ts");
    const legacyPaths = contents.match(/const MEMBER_APP_PATHS[\s\S]*?\]\);/)?.[0] ?? "";

    expect(legacyPaths).not.toContain('"/app",');
  });

  it("routes operator and Member root navigation through the Overview section", () => {
    const contents = source("src/components/app-shell.tsx");

    expect(contents).toContain('workspaceAccess("owner").section("overview").navigation');
    expect(contents).toContain('workspaceAccess("member").section("overview").navigation');
    expect(contents).not.toContain('items: [["/app", "home", "Overview"]]');
    expect(contents).not.toMatch(/<Icon name="home" \/>Dashboard/);
  });

  it("uses the shared presentation decision for the restricted Member page", () => {
    const contents = source("src/app/app/page.tsx");

    expect(contents).toContain('.section("overview")');
    expect(contents).toContain('presentation === "member"');
    expect(contents).not.toContain('membership.role === "member"');
  });
});
