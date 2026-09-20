import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import playwrightConfig from "../../playwright.config";

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

describe("Playwright CI failure diagnostics", () => {
  it("captures a screenshot for a failed browser check", () => {
    expect((playwrightConfig.use as { screenshot?: string }).screenshot).toBe("only-on-failure");
  });

  it("uploads only bounded browser evidence without session-bearing traces", () => {
    const workflow = read(".github/workflows/ci.yml");

    expect(workflow).toContain("Upload bounded browser failure evidence");
    expect(workflow).toContain("test-results/github-connection-*/test-failed-*.png");
    expect(workflow).toContain("test-results/github-connection-*/error-context.md");
    expect(workflow).toContain("if-no-files-found: warn");
    expect(workflow).not.toMatch(/^\s*path:\s*test-results\/?\s*$/m);
    expect(workflow).not.toContain("test-results/**/");
    expect(workflow).not.toMatch(/test-results\/\*\*\/trace\.zip/);
    expect(workflow).not.toMatch(/test-results\/\*\*\/\*\.webm/);
  });
});
