import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("Scope and context Workspace-access ownership", () => {
  it("routes the Scope page and save action through the shared policy", () => {
    for (const path of ["src/app/app/scope/page.tsx", "src/app/app/scope/actions.ts"]) {
      const contents = source(path);
      expect(contents).toContain("workspaceAccess");
      expect(contents).toContain('.section("scope")');
      expect(contents).not.toMatch(/membership\.role\s*[!=]==?\s*["'](?:owner|admin|member)["']/);
    }
  });

  it("does not add Scope and context to the legacy Member route allowlist", () => {
    const contents = source("src/features/organisations/domain/portal-access.ts");
    expect(contents).not.toContain('"/app/scope",');
  });
});
