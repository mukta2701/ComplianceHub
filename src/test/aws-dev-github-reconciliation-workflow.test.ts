import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const action = () => read(".github/actions/reconcile-github-connections-aws-dev/action.yml");
const reconciliationWorkflow = () =>
  read(".github/workflows/reconcile-github-connections-aws-dev.yml");
const deployWorkflow = () => read(".github/workflows/deploy-aws-dev.yml");

const extractActionRun = (stepName: string) => {
  const source = action();
  const nameStart = source.indexOf(`    - name: ${stepName}`);
  const marker = "      run: |\n";
  const start = source.indexOf(marker, nameStart);
  const end = source.indexOf("\n    - name:", start + marker.length);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source
    .slice(start + marker.length, end)
    .split("\n")
    .map((line) => line.replace(/^          /, ""))
    .join("\n");
};

type ResolverFixture = {
  image?: string;
  expectedDigest?: string;
  expectedRelease?: string;
  healthRelease?: string;
  requireImageBinding?: boolean;
};

const runResolver = (fixture: ResolverFixture) => {
  const directory = mkdtempSync(join(tmpdir(), "compliancehub-resolver-test-"));
  const outputPath = join(directory, "github-output");
  const awsPath = join(directory, "aws");
  const curlPath = join(directory, "curl");

  writeFileSync(
    awsPath,
    `#!/usr/bin/env bash\nprintf '%s\\n' '${fixture.image ?? `123456789012.dkr.ecr.eu-west-2.amazonaws.com/compliancehub-dev@sha256:${"a".repeat(64)}`}'\n`,
    { mode: 0o700 },
  );
  writeFileSync(
    curlPath,
    `#!/usr/bin/env bash\nprintf '%s\\n' '{"status":"ok","releaseSha":"${fixture.healthRelease ?? "abcdef1"}"}'\n`,
    { mode: 0o700 },
  );
  chmodSync(awsPath, 0o700);
  chmodSync(curlPath, 0o700);
  writeFileSync(outputPath, "");

  const result = spawnSync("bash", ["-c", extractActionRun("Resolve current App Runner image")], {
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH ?? ""}`,
      AWS_REGION: "eu-west-2",
      AWS_DEV_SERVICE_ARN: "arn:aws:apprunner:eu-west-2:123456789012:service/dev/fixture",
      AWS_DEV_ECR_REGISTRY: "123456789012.dkr.ecr.eu-west-2.amazonaws.com",
      ECR_REPOSITORY: "compliancehub-dev",
      AWS_DEV_SITE_URL: "https://example.invalid",
      EXPECTED_RELEASE_SHA: fixture.expectedRelease ?? "",
      EXPECTED_IMAGE_DIGEST: fixture.expectedDigest ?? "",
      REQUIRE_IMAGE_BINDING: fixture.requireImageBinding === false ? "false" : "true",
      GITHUB_OUTPUT: outputPath,
    },
    encoding: "utf8",
  });

  const output = readFileSync(outputPath, "utf8");
  rmSync(directory, { recursive: true, force: true });
  return { ...result, output };
};

describe("AWS dev GitHub reconciliation workflow", () => {
  it("defines a local composite action with non-secret inputs and one digest output", () => {
    const source = action();

    expect(source).toContain("name: Reconcile GitHub connections (AWS dev)");
    expect(source).toContain("using: composite");
    expect(source).toContain("expected-release-sha:");
    expect(source).toContain("expected-image-digest:");
    expect(source).toContain("require-image-binding:");
    expect(source).toMatch(/outputs:\s*\n\s+image-digest:/);
    expect(source).toContain("value: ${{ steps.image.outputs.digest }}");
    const inputBlock = source.slice(source.indexOf("inputs:"), source.indexOf("outputs:"));
    expect(inputBlock).not.toMatch(/SECRET|PRIVATE_KEY|WEBHOOK/i);
  });

  it("defines a protected, immutable, bounded scheduled workflow", () => {
    const workflow = reconciliationWorkflow();

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
    expect(workflow).toContain("./.github/actions/reconcile-github-connections-aws-dev");
    expect(workflow).not.toContain("workflow_call:");
    expect(workflow).not.toContain("uses: ./.github/workflows/");
  });

  it("executes the resolver against matching fixtures and emits only the digest", () => {
    const digest = "sha256:" + "a".repeat(64);
    const result = runResolver({
      image: `123456789012.dkr.ecr.eu-west-2.amazonaws.com/compliancehub-dev@${digest}`,
      expectedDigest: digest,
      expectedRelease: "abcdef1",
      healthRelease: "abcdef1",
    });

    expect(result.status).toBe(0);
    expect(result.output).toBe(`digest=${digest}\n`);
    expect(result.output).not.toContain("123456789012.dkr.ecr.eu-west-2.amazonaws.com");
  });

  it.each([
    ["missing image binding", { expectedDigest: "" }],
    ["malformed image binding", { expectedDigest: "sha256:not-a-digest" }],
    ["different valid image binding", { expectedDigest: "sha256:" + "b".repeat(64) }],
    [
      "wrong registry",
      {
        image: "another.example.invalid/compliancehub-dev@sha256:" + "a".repeat(64),
        expectedDigest: "sha256:" + "a".repeat(64),
      },
    ],
    [
      "wrong repository",
      {
        image:
          "123456789012.dkr.ecr.eu-west-2.amazonaws.com/other-repository@sha256:" +
          "a".repeat(64),
        expectedDigest: "sha256:" + "a".repeat(64),
      },
    ],
    [
      "malformed deployed digest",
      {
        image:
          "123456789012.dkr.ecr.eu-west-2.amazonaws.com/compliancehub-dev@sha256:not-a-digest",
        expectedDigest: "sha256:not-a-digest",
      },
    ],
    [
      "wrong release",
      {
        image:
          "123456789012.dkr.ecr.eu-west-2.amazonaws.com/compliancehub-dev@sha256:" +
          "a".repeat(64),
        expectedDigest: "sha256:" + "a".repeat(64),
        expectedRelease: "abcdef1",
        healthRelease: "deadbee",
      },
    ],
  ] as const)("fails closed before a pull for %s", (_name, fixture) => {
    const result = runResolver(fixture);

    expect(result.status).not.toBe(0);
    expect(result.output).toBe("");
  });

  it("uses the same action for direct scheduled/manual execution and maps exact environment names", () => {
    const workflow = reconciliationWorkflow();
    const actionStep = workflow.slice(workflow.indexOf("uses: ./.github/actions/"));
    const expectedSecretMappings = [
      ["AWS_DEV_DEPLOY_ROLE_ARN", "AWS_DEV_DEPLOY_ROLE_ARN"],
      ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
      ["APP_ENCRYPTION_KEY", "APP_ENCRYPTION_KEY"],
      ["SLACK_ALLOWED_WEBHOOK_SHA256", "SLACK_ALLOWED_WEBHOOK_SHA256"],
      ["GITHUB_APP_ID", "AWS_DEV_GITHUB_APP_ID"],
      ["GITHUB_APP_SLUG", "AWS_DEV_GITHUB_APP_SLUG"],
      ["GITHUB_APP_CLIENT_ID", "AWS_DEV_GITHUB_APP_CLIENT_ID"],
      ["GITHUB_APP_CLIENT_SECRET", "AWS_DEV_GITHUB_APP_CLIENT_SECRET"],
      ["GITHUB_APP_PRIVATE_KEY", "AWS_DEV_GITHUB_APP_PRIVATE_KEY"],
      ["GITHUB_WEBHOOK_SECRET", "AWS_DEV_GITHUB_WEBHOOK_SECRET"],
      ["GITHUB_ALLOWED_ACCOUNT_ID", "AWS_DEV_GITHUB_ALLOWED_ACCOUNT_ID"],
    ];

    expect(actionStep).toContain("expected-release-sha: ${{ inputs.expected_release_sha }}");
    expect(actionStep).toContain('expected-image-digest: ""');
    expect(actionStep).toContain('require-image-binding: "false"');
    for (const [runtimeName, secretName] of expectedSecretMappings) {
      expect(actionStep).toContain(`${runtimeName}: \${{ secrets.${secretName} }}`);
    }
    expect(actionStep).toContain("GITHUB_ALLOWED_ACCOUNT_TYPE: Organization");
    expect(actionStep).not.toContain("GITHUB_PERSONAL_ACCESS_TOKEN");
    expect(actionStep).not.toContain("CRON_SECRET");
  });

  it("runs two ordinary acceptance jobs with the same immutable digest binding", () => {
    const workflow = deployWorkflow();
    const first = jobBlock(workflow, "reconcile_acceptance_first", "reconcile_acceptance_second");
    const second = jobBlock(workflow, "reconcile_acceptance_second");

    expect(workflow).toMatch(
      /workflow_dispatch:\s*\n\s+inputs:\s*\n\s+run_github_reconciliation_acceptance:[\s\S]*?default:\s*false[\s\S]*?type:\s*boolean/,
    );
    expect(workflow).toMatch(
      /deploy:\s*\n\s+outputs:\s*\n\s+image_digest:\s+\$\{\{\s*steps\.image_reference\.outputs\.image_digest\s*\}\}/,
    );

    for (const block of [first, second]) {
      expect(block).toContain(
        "if: github.event_name == 'workflow_dispatch' && inputs.run_github_reconciliation_acceptance == true",
      );
      expect(block).toContain("runs-on: ubuntu-24.04");
      expect(block).toContain("environment: aws-dev");
      expect(block).toContain("timeout-minutes: 10");
      expect(block).toContain("group: compliancehub-github-reconcile-aws-dev");
      expect(block).toMatch(/permissions:\s*\n\s+contents: read\s*\n\s+id-token: write/);
      expect(block).toContain("ref: ${{ github.sha }}");
      expect(block).toContain("uses: ./.github/actions/reconcile-github-connections-aws-dev");
      expect(block).toContain("expected-release-sha: ${{ github.sha }}");
      expect(block).toContain("expected-image-digest: ${{ needs.deploy.outputs.image_digest }}");
      expect(block).toContain('require-image-binding: "true"');
      expect(block).toContain("env:");
      expect(block).not.toContain("uses: ./.github/workflows/");
    }
    expect(first).toMatch(/needs:\s*deploy/);
    expect(second).toMatch(/needs:\s*\n\s+- deploy\s*\n\s+- reconcile_acceptance_first/);
    expect(workflow).not.toContain("image_uri: ${{ needs.deploy.outputs");
  });

  it("keeps image resolution, health validation, binding failure, and pull in order", () => {
    const source = action();
    const resolve = source.indexOf("Resolve current App Runner image");
    const pull = source.indexOf("Log in to ECR and pull immutable image");
    const runner = source.indexOf("Run bounded connection reconciliation");

    expect(resolve).toBeGreaterThanOrEqual(0);
    expect(pull).toBeGreaterThan(resolve);
    expect(runner).toBeGreaterThan(pull);
    expect(source.slice(resolve, pull)).toContain("aws apprunner describe-service");
    expect(source.slice(resolve, pull)).toContain("REQUIRE_IMAGE_BINDING");
    expect(source.slice(resolve, pull)).toContain("EXPECTED_IMAGE_DIGEST");
    expect(source.slice(resolve, pull)).toContain("expected-image-digest");
    expect(source.slice(resolve, pull)).toContain("exit 1");
    expect(source.slice(pull, runner)).toContain("docker login");
    expect(source.slice(pull, runner)).toContain("docker pull");
    const runnerBlock = source.slice(runner);
    expect(runnerBlock).toContain("NODE_ENV: production");
    expect(runnerBlock).toContain("node dist/github-connection-reconcile.mjs");
    expect(runnerBlock).toContain("trap cleanup EXIT");
    expect(runnerBlock).not.toContain("--env-file");
  });

  it("passes App Runner runtime configuration through a private input file", () => {
    const workflow = deployWorkflow();
    const updateStart = workflow.indexOf("      - name: Update App Runner service");
    const verifyStart = workflow.indexOf("      - name: Verify deployed health", updateStart);
    const updateStep = workflow.slice(updateStart, verifyStart);
    const runScript = updateStep.slice(updateStep.indexOf("        run: |"));
    const updateCommand = runScript
      .split("\n")
      .find((line) => line.includes("aws apprunner update-service"));
    const expectedSecretMappings = [
      ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
      ["CRON_SECRET", "CRON_SECRET"],
      ["APP_ENCRYPTION_KEY", "APP_ENCRYPTION_KEY"],
      ["SLACK_ALLOWED_WEBHOOK_SHA256", "SLACK_ALLOWED_WEBHOOK_SHA256"],
      ["GITHUB_APP_ID", "AWS_DEV_GITHUB_APP_ID"],
      ["GITHUB_APP_CLIENT_ID", "AWS_DEV_GITHUB_APP_CLIENT_ID"],
      ["GITHUB_APP_CLIENT_SECRET", "AWS_DEV_GITHUB_APP_CLIENT_SECRET"],
      ["GITHUB_APP_PRIVATE_KEY", "AWS_DEV_GITHUB_APP_PRIVATE_KEY"],
      ["GITHUB_WEBHOOK_SECRET", "AWS_DEV_GITHUB_WEBHOOK_SECRET"],
      ["GITHUB_APP_SLUG", "AWS_DEV_GITHUB_APP_SLUG"],
      ["GITHUB_ALLOWED_ACCOUNT_ID", "AWS_DEV_GITHUB_ALLOWED_ACCOUNT_ID"],
      [
        "GITHUB_APPROVED_SECURITY_WORKFLOW_IDS",
        "AWS_DEV_GITHUB_APPROVED_SECURITY_WORKFLOW_IDS",
      ],
    ];
    const runtimeMappings = [
      "HOSTNAME: \"::\"",
      "NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SITE_URL: env.NEXT_PUBLIC_SITE_URL",
      "SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY",
      "CRON_SECRET: env.CRON_SECRET",
      "APP_ENCRYPTION_KEY: env.APP_ENCRYPTION_KEY",
      "SLACK_ALLOWED_WEBHOOK_SHA256: env.SLACK_ALLOWED_WEBHOOK_SHA256",
      "COMPLIANCEHUB_RELEASE_SHA: env.DEPLOY_SHA",
      "GITHUB_APP_ID: env.GITHUB_APP_ID",
      "GITHUB_APP_CLIENT_ID: env.GITHUB_APP_CLIENT_ID",
      "GITHUB_APP_CLIENT_SECRET: env.GITHUB_APP_CLIENT_SECRET",
      "GITHUB_APP_PRIVATE_KEY: env.GITHUB_APP_PRIVATE_KEY",
      "GITHUB_WEBHOOK_SECRET: env.GITHUB_WEBHOOK_SECRET",
      "GITHUB_APP_SLUG: env.GITHUB_APP_SLUG",
      "GITHUB_ALLOWED_ACCOUNT_ID: env.GITHUB_ALLOWED_ACCOUNT_ID",
      'GITHUB_ALLOWED_ACCOUNT_TYPE: "Organization"',
      "GITHUB_APPROVED_SECURITY_WORKFLOW_IDS: env.GITHUB_APPROVED_SECURITY_WORKFLOW_IDS",
    ];

    expect(updateStart).toBeGreaterThanOrEqual(0);
    expect(verifyStart).toBeGreaterThan(updateStart);
    for (const [runtimeName, secretName] of expectedSecretMappings) {
      expect(updateStep).toContain(`${runtimeName}: \${{ secrets.${secretName} }}`);
      expect(runScript).toContain(`${runtimeName}: env.${runtimeName}`);
    }
    for (const mapping of runtimeMappings) expect(runScript).toContain(mapping);

    expect(runScript).toContain('umask 077');
    expect(runScript).toContain('request_file="$(mktemp)"');
    expect(runScript).toContain('chmod 600 "$request_file"');
    expect(runScript).toContain('trap \'rm -f "$request_file"\' EXIT');
    expect(runScript).toContain('jq -n');
    expect(runScript).toContain('> "$request_file"');
    expect(runScript).toContain('ServiceArn: env.SERVICE_ARN');
    expect(runScript).toContain('SourceConfiguration:');
    expect(updateCommand?.trim()).toBe(
      'aws apprunner update-service --region "$AWS_REGION" --cli-input-json "file://$request_file" --query \'Service.Status\' --output text >/dev/null',
    );
    expect(runScript).not.toMatch(/--arg\b/);
    expect(runScript).not.toMatch(/echo[^\n]*SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("documents Organization as the hosted account-type requirement", () => {
    const envExample = read(".env.example");

    expect(envExample).toContain("Hosted AWS dev and production require Organization");
    expect(envExample).toContain("Set to User only for a local 127.0.0.1");
    expect(envExample).toContain("development/test stack");
    expect(envExample).not.toContain("Staging requires Organization");
  });
});
