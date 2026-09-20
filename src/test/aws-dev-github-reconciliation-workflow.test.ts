import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(`${process.cwd()}/${path}`, "utf8");

const jobBlock = (workflow: string, jobName: string, nextJobName?: string) => {
  const start = workflow.indexOf(`  ${jobName}:`);
  const end = nextJobName
    ? workflow.indexOf(`  ${nextJobName}:`, start)
    : workflow.length;

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return workflow.slice(start, end);
};

describe("AWS dev GitHub reconciliation workflow", () => {
  it("defines a protected, immutable, bounded scheduled workflow", () => {
    const workflow = read(
      ".github/workflows/reconcile-github-connections-aws-dev.yml",
    );

    expect(workflow).toContain('cron: "23 * * * *"');
    expect(workflow).toMatch(/workflow_dispatch:\s*\n\s+inputs:/);
    expect(workflow).toContain("expected_release_sha");
    expect(workflow).toMatch(/permissions:\s*\n\s+contents: read/);
    expect(workflow).toContain("group: compliancehub-github-reconcile-aws-dev");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("environment: aws-dev");
    expect(workflow).toMatch(
      /permissions:\s*\n\s+contents: read\s*\n\s+id-token: write/,
    );
    expect(workflow).toContain("timeout-minutes: 10");
    expect(workflow).toContain("timeout 7m");
    expect(workflow).toContain("aws apprunner describe-service");
    expect(workflow).toContain(
      '${AWS_DEV_ECR_REGISTRY}/compliancehub-dev@sha256:',
    );
    expect(workflow).toContain("docker login");
    expect(workflow).toContain("node dist/github-connection-reconcile.mjs");
    expect(workflow).toMatch(/NODE_ENV:\s+production/);
    expect(workflow).toMatch(/GITHUB_ALLOWED_ACCOUNT_TYPE:\s+Organization/);
    expect(workflow).toContain("GITHUB_CONNECTION_MAX_WEBHOOK_DELIVERIES");
    expect(workflow).toContain("GITHUB_CONNECTION_MAX_INSTALLATIONS");
    expect(workflow).toContain("GITHUB_CONNECTION_MAX_SLACK_DELIVERIES");
    expect(workflow).toContain("GITHUB_CONNECTION_TIME_BUDGET_MS");
    expect(workflow).toContain("SLACK_ALLOWED_WEBHOOK_SHA256");
    expect(workflow).toContain("trap cleanup EXIT");
    expect(workflow).toMatch(/docker run[\s\S]*--env-file|docker run[\s\S]*--env [A-Z_]+/);

    expect(workflow).not.toContain("docker build");
    expect(workflow).not.toMatch(/\blatest\b/);
    expect(workflow).not.toContain("upload-artifact");
    expect(workflow).not.toContain("/api/cron/monitor");
    expect(workflow).not.toContain("claim_alert_delivery");
    expect(workflow).not.toMatch(/--env\s+[A-Z_]+=\$\{/);
    expect(workflow).not.toContain("CRON_SECRET");
    expect(workflow).not.toContain("GITHUB_PERSONAL_ACCESS_TOKEN");
    expect(workflow).not.toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(workflow).not.toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  });

  it("supports reusable calls while keeping the direct manual release check optional", () => {
    const workflow = read(
      ".github/workflows/reconcile-github-connections-aws-dev.yml",
    );

    expect(workflow).toMatch(
      /workflow_dispatch:\s*\n\s+inputs:\s*\n\s+expected_release_sha:[\s\S]*?required:\s*false[\s\S]*?type:\s*string/,
    );
    expect(workflow).toMatch(
      /workflow_call:\s*\n\s+inputs:\s*\n\s+expected_release_sha:[\s\S]*?required:\s*true[\s\S]*?type:\s*string[\s\S]*?expected_image_uri:[\s\S]*?required:\s*true[\s\S]*?type:\s*string/,
    );
  });

  it("publishes one immutable image output and runs two opted-in calls in order", () => {
    const workflow = read(".github/workflows/deploy-aws-dev.yml");
    const first = jobBlock(workflow, "reconcile_acceptance_first", "reconcile_acceptance_second");
    const second = jobBlock(workflow, "reconcile_acceptance_second");

    expect(workflow).toMatch(
      /workflow_dispatch:\s*\n\s+inputs:\s*\n\s+run_github_reconciliation_acceptance:[\s\S]*?default:\s*false[\s\S]*?type:\s*boolean/,
    );
    expect(workflow).toMatch(
      /deploy:\s*\n\s+outputs:\s*\n\s+image_uri:\s+\$\{\{\s*steps\.image_reference\.outputs\.image_uri\s*\}\}/,
    );

    expect(workflow).toMatch(
      /name: Set image reference\s*\n\s+id: image_reference[\s\S]*?echo "IMAGE_URI=\$image_uri" >> "\$GITHUB_ENV"[\s\S]*?echo "image_uri=\$image_uri" >> "\$GITHUB_OUTPUT"/,
    );
    for (const block of [first, second]) {
      expect(block).toContain(
        "if: github.event_name == 'workflow_dispatch' && inputs.run_github_reconciliation_acceptance == true",
      );
      expect(block).toContain("uses: ./.github/workflows/reconcile-github-connections-aws-dev.yml");
      expect(block).toContain("expected_release_sha: ${{ github.sha }}");
      expect(block).toContain(
        "expected_image_uri: ${{ needs.deploy.outputs.image_uri }}",
      );
      expect(block).toMatch(
        /permissions:\s*\n\s+contents: read\s*\n\s+id-token: write/,
      );
      expect(block).not.toMatch(/secrets:\s*inherit|environment:|runs-on:|steps:/);
    }
    expect(first).toMatch(/needs:\s*deploy/);
    expect(second).toMatch(
      /needs:\s*\n\s+- deploy\s*\n\s+- reconcile_acceptance_first/,
    );
  });

  it("checks the expected immutable image before pull and rejects a digest mismatch", () => {
    const workflow = read(
      ".github/workflows/reconcile-github-connections-aws-dev.yml",
    );
    const resolveStart = workflow.indexOf("Resolve current App Runner image");
    const pullStart = workflow.indexOf("Log in to ECR and pull immutable image");
    const resolve = workflow.slice(resolveStart, pullStart);

    expect(resolve).toContain("EXPECTED_IMAGE_URI: ${{ inputs.expected_image_uri }}");
    expect(resolve).not.toMatch(/\$\{\{\s*inputs\.expected_image_uri\s*\}\}[^\n]*run/);
    expect(resolve).toMatch(
      /if \[\[ -n "\$EXPECTED_IMAGE_URI" && "\$EXPECTED_IMAGE_URI" != "\$image" \]\]/,
    );
    expect(resolve).toMatch(
      /expected_image_uri[\s\S]*(?:mismatch|does not match)[\s\S]*exit 1/,
    );
    const mismatchGuard = workflow.indexOf(
      'if [[ -n "$EXPECTED_IMAGE_URI" && "$EXPECTED_IMAGE_URI" != "$image" ]]',
    );
    expect(mismatchGuard).toBeGreaterThanOrEqual(resolveStart);
    expect(mismatchGuard).toBeLessThan(pullStart);
  });

  it("rejects mutable, wrong-registry, and wrong-repository image identifiers", () => {
    const workflow = read(
      ".github/workflows/reconcile-github-connections-aws-dev.yml",
    );
    const validation = workflow.slice(
      workflow.indexOf("Resolve current App Runner image"),
      workflow.indexOf("Log in to ECR"),
    );

    expect(validation).toContain("tag-only");
    expect(validation).toContain("wrong registry");
    expect(validation).toContain("wrong repository");
    expect(validation).toMatch(/reject|fail|exit 1/);
  });

  it("maps the approved Slack digest into App Runner without printing it", () => {
    const workflow = read(".github/workflows/deploy-aws-dev.yml");

    expect(workflow).toContain(
      "SLACK_ALLOWED_WEBHOOK_SHA256: ${{ secrets.SLACK_ALLOWED_WEBHOOK_SHA256 }}",
    );
    expect(workflow).toMatch(
      /--arg slackDigest \"\$SLACK_ALLOWED_WEBHOOK_SHA256\"/,
    );
    expect(workflow).toMatch(
      /SLACK_ALLOWED_WEBHOOK_SHA256: \$slackDigest/,
    );
    expect(workflow).not.toMatch(/echo[^\n]*SLACK_ALLOWED_WEBHOOK_SHA256/);
  });

  it("documents Organization as the hosted account-type requirement", () => {
    const envExample = read(".env.example");

    expect(envExample).toContain(
      "Hosted AWS dev and production require Organization",
    );
    expect(envExample).toContain("Set to User only for a local 127.0.0.1");
    expect(envExample).toContain("development/test stack");
    expect(envExample).not.toContain("Staging requires Organization");
  });
});
