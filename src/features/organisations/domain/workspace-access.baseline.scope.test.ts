import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("Saved baseline Workspace-access ownership", () => {
  it("routes the Saved baseline page and save action through the shared policy", () => {
    for (const path of [
      "src/app/app/baseline/page.tsx",
      "src/app/app/baseline/actions.ts",
    ]) {
      const contents = source(path);
      expect(contents).toContain("workspaceAccess");
      expect(contents).toContain('.section("baseline")');
      expect(contents).not.toMatch(/membership\.role\s*[!=]==?\s*["'](?:owner|admin|member)["']/);
    }
  });

  it("removes Saved baseline from the legacy Member route allowlist", () => {
    const contents = source("src/features/organisations/domain/portal-access.ts");
    expect(contents).not.toContain('"/app/baseline",');
  });
});
