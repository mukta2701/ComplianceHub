import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("GitHub Monitoring route boundary", () => {
  it("keeps Monitoring components independent from Integrations server actions", () => {
    const componentSources = [
      "github-collection-health-panel.tsx",
      "github-compliance-control-room.tsx",
    ].map((name) => readFileSync(join(root, "src/features/github/components", name), "utf8"));

    expect(componentSources.every((source) => !source.includes("@/app/app/integrations/"))).toBe(true);
  });

  it("keeps Integrations action modules free of GitHub collection and materialisation operations", () => {
    const actionSources = readdirSync(join(root, "src/app/app/integrations"))
      .filter((name) => name.endsWith("actions.ts"))
      .map((name) => readFileSync(join(root, "src/app/app/integrations", name), "utf8"))
      .join("\n");

    for (const operationalExport of [
      "approveGitHubMappingPackAction",
      "revokeGitHubMappingApprovalAction",
      "processApprovedGitHubResultsAction",
      "retryExhaustedGitHubMaterialisationAction",
    ]) {
      expect(actionSources).not.toContain(`export async function ${operationalExport}`);
    }
  });

  it("scopes full-width 44px phone actions and their forms to Monitoring", () => {
    const stylesheet = readFileSync(join(root, "src/app/globals.css"), "utf8");

    for (const selector of [
      ".monitoring-page .monitor-banner-actions",
      ".monitoring-page .finding-actions",
      ".monitoring-page .github-finding-review",
      ".monitoring-page .github-collection-health-panel",
      ".monitoring-page .monitor-technical-review",
    ]) {
      expect(stylesheet).toContain(selector);
    }
    expect(stylesheet).toContain(".monitoring-page form{width:100%}");
    expect(stylesheet).toContain(".monitoring-page .button{width:100%;min-height:44px}");
    expect(stylesheet).not.toContain("@media(max-width:640px){.button{width:100%;min-height:44px}");
  });
});
