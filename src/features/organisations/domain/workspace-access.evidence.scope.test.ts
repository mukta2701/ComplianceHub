import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Evidence workspace-access ownership", () => {
  it.each([
    "src/app/app/evidence/page.tsx",
    "src/app/app/evidence/new/page.tsx",
    "src/app/app/evidence/actions.ts",
  ])("routes Evidence role decisions in %s through the shared section", (relativePath) => {
    const contents = source(relativePath);

    expect(contents).toContain("workspaceAccess");
    expect(contents).toContain('.section("evidence")');
    expect(contents).not.toMatch(/membership(?:\?|)\.role\s*(?:===|!==)/);
  });

  it("sources operator Evidence navigation from workspace access", () => {
    const contents = source("src/components/app-shell.tsx");

    expect(contents).toContain('workspaceAccess("owner").section("evidence").navigation');
    expect(contents).not.toContain('["/app/evidence", "file", "Evidence"]');
  });

  it("does not add the management gate to file downloads", () => {
    const contents = source("src/app/app/evidence/actions.ts");
    const download = contents.slice(contents.indexOf("export async function downloadEvidenceAction"));

    expect(download).not.toContain("requireManage");
  });
});
