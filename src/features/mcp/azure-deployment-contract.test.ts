import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

describe("Azure staging deployment contract", () => {
  const workflow = read(".github/workflows/deploy-azure-staging.yml");
  const bicep = read("infra/azure/application.bicep");

  it("deploys main only after the complete CI workflow succeeds", () => {
    expect(workflow).toMatch(/workflow_run:[\s\S]*workflows: \[CI][\s\S]*branches: \[main]/);
    expect(workflow).toMatch(/github\.event\.workflow_run\.conclusion == 'success'/);
    expect(workflow).not.toMatch(/branches: \[[^\]]*codex\/internal-mcp-digest/);
    expect(workflow).toMatch(/DEPLOY_SHA:.*workflow_run\.head_sha/);
  });

  it("keeps Azure OIDC out of build and verification", () => {
    const publish = workflow.slice(workflow.indexOf("  publish:"), workflow.indexOf("  deploy:"));
    const deploy = workflow.slice(workflow.indexOf("  deploy:"));
    expect(publish).not.toContain("id-token: write");
    expect(publish).not.toContain("environment: azure-staging");
    expect(deploy).toContain("id-token: write");
    expect(deploy).toContain("environment: azure-staging");
  });

  it("retains the previous credential slot and creates a fresh revision on rerun", () => {
    expect(workflow).toMatch(/current_service_ref[\s\S]*supabase-service-role-a[\s\S]*secret_slot="b"/);
    expect(workflow).toMatch(/secret_slot="a"/);
    expect(workflow).toContain("run-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}");
    expect(bicep).toContain("param supabaseRefName string");
    expect(bicep).toContain("secretRef: supabaseRefName");
    expect(bicep).not.toMatch(/param supabaseServiceRoleKey|string\s+supabaseServiceRoleKey/);
    expect(bicep).not.toMatch(/configuration:\s*\{[\s\S]*?secrets:\s*\[/);
  });

  it("functionally verifies OAuth/MCP and restores the previous healthy revision", () => {
    expect(workflow).toContain("/.well-known/oauth-protected-resource");
    expect(workflow).toContain('test "$mcp_status" = "401"');
    expect(workflow).toMatch(/www-authenticate: Bearer resource_metadata/);
    expect(workflow).toMatch(/if: failure\(\) && steps\.rollout\.outputs\.previous-revision != ''/);
    expect(workflow).toMatch(/containerapp revision copy[\s\S]*--from-revision/);
  });
});
