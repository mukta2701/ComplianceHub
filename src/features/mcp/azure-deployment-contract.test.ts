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
  const githubShadowPilot = read("docs/deployment/github-shadow-pilot.md");
  const task6Brief = read(".superpowers/sdd/2026-08-24-github-compliance-integration/task-6-brief.md");
  const task6Report = read(".superpowers/sdd/2026-08-24-github-compliance-integration/task-6-report.md");
  const progress = read(".superpowers/sdd/2026-08-24-github-compliance-integration/progress.md");
  const slackMigration = read("supabase/migrations/20260825053718_restrict_slack_delivery_destination.sql");
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
    expect(workflow).toContain("# BRIDGE_REF_POLICY_BEGIN");
    expect(workflow).toContain("# FINAL_REF_POLICY_BEGIN");
    expect(workflow).toMatch(/secret_slot="a"/);
    expect(workflow).toContain("run-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}");
    expect(bicep).toContain("param supabaseRefName string");
    expect(bicep).toContain("secretRef: supabaseRefName");
    expect(bicep).not.toMatch(/param supabaseServiceRoleKey|string\s+supabaseServiceRoleKey/);
    expect(bicep).not.toMatch(/configuration:\s*\{[\s\S]*?secrets:\s*\[/);
  });

  it("allows bridge only by explicit manual dispatch and forces every automatic rollout to final strict mode", () => {
    expect(workflow).toMatch(/workflow_dispatch:[\s\S]*rollout_phase:[\s\S]*type: choice[\s\S]*options:[\s\S]*- bridge[\s\S]*- final[\s\S]*default: final/);
    expect(workflow).toContain("ROLLOUT_PHASE: ${{ github.event_name == 'workflow_dispatch' && inputs.rollout_phase || 'final' }}");
    expect(workflow).toMatch(/case "\$ROLLOUT_PHASE" in[\s\S]*bridge\)[\s\S]*runtime_reservation_mode="bridge"[\s\S]*final\)[\s\S]*runtime_reservation_mode="strict"/);
    expect(workflow).not.toMatch(/workflow_run[\s\S]{0,300}bridge/);
  });

  it("keeps both reservation overloads service-only during the staged bridge", () => {
    expect(slackMigration).not.toMatch(/drop function public\.reserve_daily_digest_delivery_server\(uuid,uuid,date,text,jsonb\)/i);
    for (const signature of [
      "reserve_daily_digest_delivery_server(uuid,uuid,date,text,jsonb)",
      "reserve_daily_digest_delivery_server(uuid,uuid,uuid,date,text,jsonb)",
    ]) {
      expect(slackMigration).toContain(`revoke all on function public.${signature}`);
      expect(slackMigration).toContain(`grant execute on function public.${signature}`);
    }
  });

  it.each([
    ["bridge", "bridge", "20260825040825"],
    ["final", "strict", "20260825094343"],
  ] as const)("maps %s rollout to %s runtime and exact %s schema", (phase, runtimeMode, migration) => {
    const phaseBlock = workflow.match(new RegExp(`${phase}\\)([\\s\\S]*?);;`))?.[1] ?? "";
    expect(phaseBlock).toContain(`runtime_reservation_mode="${runtimeMode}"`);
    expect(phaseBlock).toContain(`expected_migration_version="${migration}"`);
    expect(workflow).toContain('test "$HOSTED_SUPABASE_MIGRATION_VERSION" = "${{ steps.rollout.outputs.expected-migration-version }}"');
  });

  it("accepts a missing Slack reference only during bridge and requires exact same-slot references for final", () => {
    const bridgeRefs = workflow.slice(
      workflow.indexOf("# BRIDGE_REF_POLICY_BEGIN"),
      workflow.indexOf("# BRIDGE_REF_POLICY_END"),
    );
    const finalRefs = workflow.slice(
      workflow.indexOf("# FINAL_REF_POLICY_BEGIN"),
      workflow.indexOf("# FINAL_REF_POLICY_END"),
    );

    expect(bridgeRefs).toMatch(/-z "\$current_service_ref"[\s\S]*-z "\$current_encryption_ref"[\s\S]*-z "\$current_cron_ref"[\s\S]*-z "\$current_slack_allowed_ref"/);
    expect(bridgeRefs).toMatch(/supabase-service-role-a[\s\S]*app-encryption-a[\s\S]*cron-secret-a[\s\S]*-z "\$current_slack_allowed_ref"[\s\S]*slack-allowed-webhook-a/);
    expect(finalRefs).toMatch(/supabase-service-role-a[\s\S]*app-encryption-a[\s\S]*cron-secret-a[\s\S]*slack-allowed-webhook-a/);
    expect(finalRefs).toMatch(/supabase-service-role-b[\s\S]*app-encryption-b[\s\S]*cron-secret-b[\s\S]*slack-allowed-webhook-b/);
    expect(finalRefs).not.toContain('-z "$current_slack_allowed_ref"');
  });

  it("allows the first manual final rollout from bridge and later manual final rollouts from strict", () => {
    expect(workflow).toMatch(/workflow_dispatch:[\s\S]*rollout_phase:[\s\S]*- final/);
    expect(workflow).toMatch(/if \[ "\$ROLLOUT_PHASE" = "final" \]; then[\s\S]*case "\$current_reservation_mode" in[\s\S]*bridge\|strict\) ;;[\s\S]*\*\) exit 1 ;;/);
  });

  it("allows automatic final rollouts to follow an exact strict policy-capable revision", () => {
    expect(workflow).toContain("ROLLOUT_PHASE: ${{ github.event_name == 'workflow_dispatch' && inputs.rollout_phase || 'final' }}");
    expect(workflow).toMatch(/if \[ "\$ROLLOUT_PHASE" = "final" \]; then[\s\S]*case "\$current_reservation_mode" in[\s\S]*bridge\|strict\) ;;[\s\S]*\*\) exit 1 ;;/);
  });

  it("proves final follows an exact policy-capable bridge or strict revision and revalidates it immediately before mutation", () => {
    expect(workflow).toMatch(/current_release_sha[\s\S]*previous_health[\s\S]*slackDestinationPolicy[\s\S]*dailyDigestReservationMode[\s\S]*releaseSha/);
    expect(workflow).toMatch(/previous_revision_fqdn[\s\S]*https:\/\/\$previous_revision_fqdn\/api\/health\/live/);
    const revalidation = workflow.slice(
      workflow.indexOf("# PRE_MUTATION_REVALIDATION_BEGIN"),
      workflow.indexOf("az containerapp secret set"),
    );
    expect(revalidation).toContain("latestReadyRevisionName");
    expect(revalidation).toContain("previous-revision");
    expect(revalidation).toContain("previous-image");
    expect(revalidation).toContain("previous-ref-fingerprint");
    expect(revalidation).toContain("# PRE_MUTATION_REVALIDATION_END");
  });

  it("stages and binds each sensitive value exactly once while exposing only nonsecret rollout capability", () => {
    expect(workflow.split("az containerapp secret set")).toHaveLength(2);
    expect(workflow.split('"DAILY_DIGEST_RESERVATION_MODE=$runtime_reservation_mode"')).toHaveLength(2);
    expect(workflow.split('"COMPLIANCEHUB_RELEASE_SHA=$DEPLOY_SHA"')).toHaveLength(2);
    expect(bicep).toContain("param dailyDigestReservationMode string = 'strict'");
    expect(bicep).toContain("param complianceHubReleaseSha string = 'unknown'");
    expect(bicep).toContain("{ name: 'DAILY_DIGEST_RESERVATION_MODE', value: dailyDigestReservationMode }");
    expect(bicep).toContain("{ name: 'COMPLIANCEHUB_RELEASE_SHA', value: complianceHubReleaseSha }");
    expect(clientSources).not.toContain("DAILY_DIGEST_RESERVATION_MODE");
    expect(clientSources).not.toContain("COMPLIANCEHUB_RELEASE_SHA");
  });

  it("verifies the deployed capability and pins bridge or strict rollback to the captured predecessor mode", () => {
    expect(workflow).toMatch(/--arg policy "v1"[\s\S]*--arg reservationMode "\$runtime_reservation_mode"[\s\S]*--arg releaseSha "\$DEPLOY_SHA"/);
    expect(workflow).toMatch(/slackDestinationPolicy == \$policy[\s\S]*dailyDigestReservationMode == \$reservationMode[\s\S]*releaseSha == \$releaseSha/);
    expect(workflow).toContain("rollback-capability-required");
    expect(workflow).toContain('echo "previous-reservation-mode=$current_reservation_mode"');
    expect(workflow).toMatch(/new_revision_fqdn[\s\S]*revision_origin="https:\/\/\$\{\{ steps\.revision\.outputs\.new-revision-fqdn \}\}"/);
    expect(workflow).toMatch(/--from-revision "\$\{\{ steps\.rollout\.outputs\.previous-revision \}\}"[\s\S]*rollback_image[\s\S]*previous-image/);
    expect(workflow).toMatch(/rollback_revision_fqdn[\s\S]*https:\/\/\$rollback_revision_fqdn\/api\/health\/live/);
    expect(workflow).toMatch(/rollback_capability_required[\s\S]*--arg reservationMode "\$\{\{ steps\.rollout\.outputs\.previous-reservation-mode \}\}"[\s\S]*dailyDigestReservationMode == \$reservationMode/);
  });

  it("keeps the one allowed Slack destination digest server-only and rotates it with the complete inactive slot", () => {
    const name = "SLACK_ALLOWED_WEBHOOK_SHA256";
    const publish = workflow.slice(workflow.indexOf("  publish:"), deployJobStart);
    const deploy = workflow.slice(deployJobStart);
    const stagedSecret = '"${{ steps.rollout.outputs.slack-allowed-ref }}=$SLACK_ALLOWED_WEBHOOK_SHA256"';
    const runtimeBinding = '"SLACK_ALLOWED_WEBHOOK_SHA256=secretref:${{ steps.rollout.outputs.slack-allowed-ref }}"';

    expect(publish).not.toContain(name);
    expect(dockerfile).not.toMatch(/(?:ARG|NEXT_PUBLIC_)\s*SLACK_ALLOWED_WEBHOOK_SHA256/);
    expect(workflow).not.toContain(`NEXT_PUBLIC_${name}`);
    expect(clientSources).not.toContain(name);
    expect(healthRoutes).not.toContain(name);
    expect(deploy).toContain(`${name}: \${{ secrets.${name} }}`);
    expect(deploy.split(stagedSecret)).toHaveLength(2);
    expect(deploy.split(runtimeBinding)).toHaveLength(2);
    expect(deploy).toMatch(/SLACK_ALLOWED_WEBHOOK_SHA256[\s\S]*\^\[0-9a-f\]\{64\}\$/);
    expect(deploy).not.toMatch(/echo[^\n]*SLACK_ALLOWED_WEBHOOK_SHA256/);
    expect(bicep).toMatch(/name: 'SLACK_ALLOWED_WEBHOOK_SHA256'[\s\S]{0,80}secretRef:/);
    expect(bicep).toContain("param slackAllowedWebhookSha256RefName string");
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
    expect(workflow).toContain("20260825094343");
    expect(workflow).toMatch(/test "\$SUPABASE_URL" = "https:\/\/\$HOSTED_SUPABASE_PROJECT_REF\.supabase\.co"/);
    expect(workflow).toContain("REGISTERED_GITHUB_APP_SITE_URL");
    expect(workflow).toMatch(/test "\$REGISTERED_GITHUB_APP_SITE_URL" = "\$CANONICAL_SITE_URL"/);
    expect(workflow).toMatch(/properties\.configuration\.ingress\.fqdn[\s\S]*test "\$CANONICAL_SITE_URL" = "https:\/\/\$container_app_fqdn"/);
    expect(deployment).toMatch(/backup[\s\S]*supabase migration list[\s\S]*HOSTED_SUPABASE_MIGRATION_VERSION/i);
    expect(deployment).toMatch(/twenty-three pending additive\s+migrations[\s\S]*20260817010000[\s\S]*20260817020000[\s\S]*20260817030000[\s\S]*20260817192458[\s\S]*20260818030000[\s\S]*20260818040000[\s\S]*20260818050000[\s\S]*20260818060000[\s\S]*20260818070000[\s\S]*20260818100000[\s\S]*20260818110000[\s\S]*20260818120000[\s\S]*20260818130000[\s\S]*20260818140000[\s\S]*20260824184627[\s\S]*20260824184628[\s\S]*20260824212223[\s\S]*20260825014236[\s\S]*20260825040825[\s\S]*20260825053718[\s\S]*20260825073650[\s\S]*20260825082411[\s\S]*20260825094343/);
    expect(deployment).toMatch(/REGISTERED_GITHUB_APP_SITE_URL[\s\S]*NEXT_PUBLIC_SITE_URL/);
    expect(releaseChecklist).toMatch(/hosted Supabase[\s\S]*migrations 1–19 were verified before the manual bridge[\s\S]*migrations 20–23 were verified before final/i);
    expect(releaseChecklist).toMatch(/GitHub App[\s\S]*canonical.*origin/i);
  });

  it("documents strict-by-default application mode and the explicit two-stage bridge procedure", () => {
    const envExample = read(".env.example");
    expect(envExample).toMatch(/DAILY_DIGEST_RESERVATION_MODE=strict/);
    expect(envExample).toMatch(/bridge[\s\S]*temporary[\s\S]*manual/i);
    expect(deployment).toMatch(/20260825040825[\s\S]*manual[\s\S]{0,200}bridge[\s\S]*policy-capable[\s\S]*20260825053718[\s\S]*20260825073650[\s\S]*20260825082411[\s\S]*20260825094343[\s\S]*manual[\s\S]{0,200}final[\s\S]*strict/i);
    expect(releaseChecklist).toMatch(/bridge[\s\S]*final[\s\S]*strict/i);
  });

  it("distinguishes the first bridge-to-strict final from strict steady-state deploys and rollback", () => {
    for (const document of [
      deployment,
      releaseChecklist,
      githubShadowPilot,
      task6Brief,
      task6Report,
      progress,
    ]) {
      expect(document).toMatch(/first final[\s\S]*bridge[\s\S]*(?:steady-state|subsequent)[\s\S]*strict/i);
      expect(document).toMatch(/rollback[\s\S]*(?:captured|previous)[\s\S]*mode/i);
    }
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
    expect(workflow.match(/curl[^\n]*--retry 5[^\n]*--retry-max-time 120/g)).toHaveLength(6);
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
