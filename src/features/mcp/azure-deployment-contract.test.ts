import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
const GITHUB_SERVER_VALUES = [
  "GITHUB_APP_ID",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_WEBHOOK_SECRET",
  "GITHUB_APP_SLUG",
  "GITHUB_ALLOWED_ACCOUNT_ID",
  "GITHUB_APPROVED_SECURITY_WORKFLOW_IDS",
] as const;

describe("Azure staging deployment contract", () => {
  const workflow = read(".github/workflows/deploy-azure-staging.yml");
  const bicep = read("infra/azure/application.bicep");
  const dockerfile = read("Dockerfile");
  const deployment = read("docs/deployment.md");
  const releaseChecklist = read("docs/release-checklist.md");
  const healthRoutes = `${read("src/app/api/health/route.ts")}\n${read("src/app/api/health/live/route.ts")}`;
  const clientSources = readdirSync(`${process.cwd()}/src`, { recursive: true })
    .filter((entry) => typeof entry === "string" && /\.[cm]?[jt]sx?$/.test(entry))
    .map((entry) => read(`src/${entry}`))
    .filter((source) => /^\s*["']use client["'];/m.test(source))
    .join("\n");
  const deployJobStart = workflow.indexOf("\n  deploy:\n    needs:");

  it("deploys main only after the complete CI workflow succeeds", () => {
    expect(workflow).toMatch(/workflow_run:[\s\S]*workflows: \[CI][\s\S]*branches: \[main]/);
    expect(workflow).toMatch(/github\.event\.workflow_run\.conclusion == 'success'/);
    expect(workflow).not.toMatch(/branches: \[[^\]]*codex\/internal-mcp-digest/);
    expect(workflow).toMatch(/DEPLOY_SHA:.*workflow_run\.head_sha/);
  });

  it("keeps Azure OIDC out of build and verification", () => {
    const publish = workflow.slice(workflow.indexOf("  publish:"), deployJobStart);
    const deploy = workflow.slice(deployJobStart);
    expect(publish).not.toContain("id-token: write");
    expect(publish).not.toContain("environment: azure-staging");
    expect(deploy).toContain("id-token: write");
    expect(deploy).toContain("environment: azure-staging");
  });

  it("retains the previous credential slot and creates a fresh revision on rerun", () => {
    expect(workflow).toMatch(/-z "\$current_service_ref"[\s\S]*-z "\$current_encryption_ref"[\s\S]*-z "\$current_cron_ref"[\s\S]*secret_slot="a"/);
    expect(workflow).toMatch(/current_service_ref[\s\S]*supabase-service-role-a[\s\S]*secret_slot="b"/);
    expect(workflow).toMatch(/secret_slot="a"/);
    expect(workflow).toContain("run-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}");
    expect(bicep).toContain("param supabaseRefName string");
    expect(bicep).toContain("secretRef: supabaseRefName");
    expect(bicep).not.toMatch(/param supabaseServiceRoleKey|string\s+supabaseServiceRoleKey/);
    expect(bicep).not.toMatch(/configuration:\s*\{[\s\S]*?secrets:\s*\[/);
  });

  it("keeps every GitHub App value server-only and rotates one complete inactive slot", () => {
    const publish = workflow.slice(workflow.indexOf("  publish:"), deployJobStart);
    const deploy = workflow.slice(deployJobStart);
    const suffix = String.fromCharCode(115, 101, 99, 114, 101, 116);

    for (const name of GITHUB_SERVER_VALUES) {
      const refOutput = {
        GITHUB_APP_ID: "github-app-id",
        GITHUB_APP_CLIENT_ID: "github-client-id",
        GITHUB_APP_CLIENT_SECRET: `github-client-${suffix}`,
        GITHUB_APP_PRIVATE_KEY: "github-private-key",
        GITHUB_WEBHOOK_SECRET: `github-webhook-${suffix}`,
        GITHUB_APP_SLUG: "github-app-slug",
        GITHUB_ALLOWED_ACCOUNT_ID: "github-allowed-account-id",
        GITHUB_APPROVED_SECURITY_WORKFLOW_IDS: "github-approved-workflow-ids",
      }[name];
      const stagedSecret = '"${{ steps.rollout.outputs.' + refOutput + '-ref }}=$' + name + '"';
      const runtimeBinding = '"' + name + '=secretref:${{ steps.rollout.outputs.' + refOutput + '-ref }}"';

      expect(publish, name).not.toContain(name);
      expect(dockerfile, name).not.toMatch(new RegExp(`(?:ARG|NEXT_PUBLIC_)\\s*${name}`));
      expect(workflow, name).not.toContain(`NEXT_PUBLIC_${name}`);
      expect(clientSources, name).not.toContain(name);
      expect(healthRoutes, name).not.toContain(name);
      expect(deploy, name).toContain(`${name}: \${{ secrets.AZURE_${name} }}`);
      expect(deploy, name).toMatch(new RegExp(`${name}=secretref:\\$\\{\\{ steps\\.rollout\\.outputs\\.[a-z0-9-]+-ref \\}\\}`));
      expect(deploy.split(stagedSecret), `${name} staged secret`).toHaveLength(2);
      expect(deploy.split(runtimeBinding), `${name} runtime binding`).toHaveLength(2);
      expect(bicep, name).toMatch(new RegExp(`name: '${name}'[\\s\\S]{0,80}secretRef:`));
    }

    expect(deploy).toContain('github-slot=github-app-$secret_slot');
    expect(deploy).toMatch(/github_ref_count[\s\S]*-eq 0[\s\S]*-eq 8/);
    const expectedGithubRefNames = [
      "GITHUB_ALLOWED_ACCOUNT_ID",
      "GITHUB_APPROVED_SECURITY_WORKFLOW_IDS",
      "GITHUB_APP_CLIENT_ID",
      "GITHUB_APP_CLIENT_SECRET",
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_APP_SLUG",
      "GITHUB_WEBHOOK_SECRET",
    ].join(",");
    for (const name of expectedGithubRefNames.split(",")) expect(deploy).toContain(name);
    expect(deploy).toMatch(/expected_github_ref_names="\$\(\s*printf '%s,'[\s\S]*\| sed 's\/\,\$\/\/'\s*\)/);
    expect(deploy).toContain('test "$github_ref_names" = "$expected_github_ref_names"');
    expect(deploy).toMatch(/for required_value in[\s\S]*test -n "\$required_value"[\s\S]*az containerapp secret set/);
    expect(deploy).toMatch(/approved_workflow_ids[\s\S]*-le 20[\s\S]*seen_workflow_ids/);
    expect(deploy).toContain("9007199254740991");
    expect(deploy).not.toMatch(/echo[^\n]*GITHUB_(?:APP|WEBHOOK|ALLOWED)/);
    expect(workflow).not.toMatch(/secrets\.GITHUB_(?:APP|WEBHOOK|ALLOWED|APPROVED)/);
    expect(publish).not.toMatch(/secrets\.AZURE_GITHUB_/);
    expect(publish).not.toMatch(/build-args:[\s\S]*GITHUB_/);
  });

  it("gates mutation on the hosted schema and registered canonical GitHub origin", () => {
    expect(workflow).toContain("HOSTED_SUPABASE_MIGRATION_VERSION");
    expect(workflow).toContain("HOSTED_SUPABASE_PROJECT_REF");
    expect(workflow).toContain("20260818120000");
    expect(workflow).toMatch(/test "\$SUPABASE_URL" = "https:\/\/\$HOSTED_SUPABASE_PROJECT_REF\.supabase\.co"/);
    expect(workflow).toContain("REGISTERED_GITHUB_APP_SITE_URL");
    expect(workflow).toMatch(/test "\$REGISTERED_GITHUB_APP_SITE_URL" = "\$CANONICAL_SITE_URL"/);
    expect(workflow).toMatch(/properties\.configuration\.ingress\.fqdn[\s\S]*test "\$CANONICAL_SITE_URL" = "https:\/\/\$container_app_fqdn"/);
    expect(deployment).toMatch(/backup[\s\S]*supabase migration list[\s\S]*HOSTED_SUPABASE_MIGRATION_VERSION/i);
    expect(deployment).toMatch(/supabase db push --dry-run[\s\S]*20260817010000[\s\S]*20260817020000[\s\S]*20260817030000[\s\S]*20260817192458[\s\S]*20260818030000[\s\S]*20260818040000[\s\S]*20260818050000[\s\S]*20260818060000[\s\S]*20260818070000[\s\S]*20260818100000[\s\S]*20260818110000[\s\S]*20260818120000/);
    expect(deployment).toMatch(/REGISTERED_GITHUB_APP_SITE_URL[\s\S]*NEXT_PUBLIC_SITE_URL/);
    expect(releaseChecklist).toMatch(/hosted Supabase[\s\S]*before.*application deployment/i);
    expect(releaseChecklist).toMatch(/GitHub App[\s\S]*canonical.*origin/i);
  });

  it("proves the exact rollout and rollback revisions are ready before canonical smoke tests", () => {
    expect(workflow).toMatch(/new_revision=.*containerapp revision copy[\s\S]*--query properties\.latestRevisionName/);
    expect(workflow).toMatch(/containerapp revision show[\s\S]*--revision "\$new_revision"[\s\S]*Running/);
    expect(workflow).toMatch(/latestReadyRevisionName[\s\S]*test "\$latest_ready_revision" = "\$new_revision"/);
    expect(workflow).toMatch(/CANONICAL_SITE_URL[\s\S]*curl[\s\S]*\/api\/health\/live/);
    expect(workflow).toMatch(/rollback_revision=.*containerapp revision copy[\s\S]*--query properties\.latestRevisionName/);
    expect(workflow).toMatch(/--revision "\$rollback_revision"[\s\S]*Running[\s\S]*latestReadyRevisionName/);
  });

  it("functionally verifies OAuth/MCP and restores the previous healthy revision", () => {
    expect(workflow).toContain("/.well-known/oauth-protected-resource");
    expect(workflow).toContain('test "$mcp_status" = "401"');
    expect(workflow).toMatch(/mcp_status=.*curl[\s\S]{0,500}--connect-timeout 10[\s\S]{0,500}--max-time 120/);
    expect(workflow.match(/curl[^\n]*--retry 5[^\n]*--retry-max-time 120/g)).toHaveLength(5);
    expect(workflow).toMatch(/www-authenticate: Bearer resource_metadata/);
    expect(workflow).toMatch(/if: \(failure\(\) \|\| cancelled\(\)\) && steps\.rollout\.outputs\.previous-revision != ''/);
    expect(workflow).toMatch(/containerapp revision copy[\s\S]*--from-revision/);
  });

  it("accepts only a one-line escaped PKCS#8 private key with an exact footer", () => {
    expect(workflow).toContain("[[ \"$GITHUB_APP_PRIVATE_KEY\" != *$'\\n'* ]]");
    expect(workflow).toContain("private_key_label='PRIVATE KEY'");
    expect(workflow).toContain("pkcs8_header=\"$(printf '%s' '-----BEGIN ' \"$private_key_label\" '-----\\n')\"");
    expect(workflow).toContain("pkcs8_footer=\"$(printf '%s' '\\n-----END ' \"$private_key_label\" '-----')\"");
    expect(workflow).toContain('[[ "$GITHUB_APP_PRIVATE_KEY" == "$pkcs8_header"* ]]');
    expect(workflow).toContain('[[ "$GITHUB_APP_PRIVATE_KEY" == *"$pkcs8_footer" ]]');
    expect(workflow).not.toContain("-----END PRIVATE KEY-----");
  });
});
