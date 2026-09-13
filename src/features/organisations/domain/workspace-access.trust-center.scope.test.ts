import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("Trust Center workspace-access ownership", () => {
  it.each([
    "src/app/app/trust/page.tsx",
    "src/app/app/trust/actions.ts",
  ])("routes %s through the shared Trust Center section", (relativePath) => {
    const contents = source(relativePath);

    expect(contents).toContain("workspaceAccess");
    expect(contents).toContain('.section("trust-center")');
    expect(contents).not.toMatch(/hasCapability\([^\n]+manage_trust_center/);
  });

  it("sources operator Trust Center navigation from workspace access", () => {
    const contents = source("src/components/app-shell.tsx");

    expect(contents).toContain('workspaceAccess("owner").section("trust-center").navigation');
    expect(contents).not.toContain('["/app/trust", "shield", "Trust Center"]');
  });
});
