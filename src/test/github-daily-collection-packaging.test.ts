import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import {
  DAILY_COLLECTION_REQUIRED_ENV,
  invalidDailyCollectionConfiguration,
  missingDailyCollectionConfiguration,
  resolveDailyCollectionImageBinding,
  sanitizeDailyCollectionRunnerLog,
} from "../../scripts/daily-collection-image-binding.mjs";

const root = resolve(import.meta.dirname, "../..");

describe("daily GitHub collection image bundle", () => {
  it("builds one Node 22 bundle without source maps", async () => {
    const builder = await readFile(resolve(root, "scripts/build-runtime-bundles.ts"), "utf8");
    const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["build:runtimes"]).toBe("node --import=tsx scripts/build-runtime-bundles.ts");
    expect(builder).toContain('entryPoints: ["scripts/github-compliance-collect.ts"]');
    expect(builder).toContain('dist/github-compliance-collect.mjs');
    expect(builder).toContain('target: "node22"');
    expect(builder).toContain("bundle: true");
    expect(builder).toContain("sourcemap: false");
  });

  it("includes the generated bundle in the immutable production image", async () => {
    const dockerfile = await readFile(resolve(root, "Dockerfile"), "utf8");

    expect(dockerfile).toContain("RUN npm run build:runtimes \\");
    expect(dockerfile).toContain("&& npm run build");
    expect(dockerfile).toContain("/app/dist ./dist");
  });
});

describe("AWS dev daily GitHub compliance collection workflow", () => {
  const workflowPath = resolve(root, ".github/workflows/collect-github-compliance-aws-dev.yml");

  it("runs on a daily schedule in the protected AWS dev environment", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain('cron: "23 9 * * *"');
    expect(workflow).toContain("environment: aws-dev");
    expect(workflow).toContain("timeout-minutes:");
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("grants only checkout and OIDC permissions, with manual release pinning", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("id-token: write");
    expect(workflow).not.toMatch(/(?:contents|issues|pull-requests|actions|packages|deployments|checks|statuses):\s*write/);
    expect(workflow).toMatch(/expected_release_sha:[\s\S]*?required: true/);
    expect(workflow).toContain("AWS_DEV_DEPLOY_ROLE_ARN");
  });

  it("checks live release health and runs only the App Runner image by digest", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("aws apprunner describe-service");
    expect(workflow).toContain("ImageIdentifier");
    expect(workflow).toContain("/api/health/live");
    expect(workflow).toContain("/api/health");
    expect(workflow).toContain("aws ecr describe-images");
    expect(workflow).toMatch(/sha256:\[0-9a-f\]\{64\}/);
    expect(workflow).toContain('docker pull "$IMAGE_URI"');
    expect(workflow).toContain('"$IMAGE_URI" dist/github-compliance-collect.mjs');
    expect(workflow).not.toContain(":latest");
    expect(workflow).toContain("--sanitize-runner-log \"$runner_log\"");
    expect(workflow).toContain('if [[ "$status" -ne 0 || "$summary_status" -ne 0 ]]; then');
    expect(workflow).not.toContain("grep ");
    expect(workflow).not.toContain("jq ");
    const ecrLoginStep = workflow.split("      - name: Log in to ECR and pull the verified image digest")[1]?.split("      - name: Run one bounded daily GitHub collection cycle")[0] ?? "";
    expect(ecrLoginStep).toContain("AWS_DEV_ECR_REGISTRY: ${{ vars.AWS_DEV_ECR_REGISTRY }}");
  });

  it("passes the narrow collector configuration and never configures Slack or deploys", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    for (const name of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_APPROVED_SECURITY_WORKFLOW_IDS",
    ]) {
      expect(workflow).toContain(name);
    }
    expect(workflow).not.toMatch(/SLACK_[A-Z0-9_]+/);
    expect(workflow).not.toContain("aws apprunner update-service");
    expect(workflow).not.toContain("GITHUB_TOKEN");
    expect(workflow).not.toContain('cat "$runner_log"');
    expect(workflow).not.toContain("::add-mask::");
    expect(workflow).toContain("scripts/daily-collection-image-binding.mjs --sanitize-runner-log");
  });

  it("fails closed when required variables or secrets are absent without echoing values", () => {
    const secretMarker = "private-fixture-secret-must-never-be-printed";
    const environment = Object.fromEntries(DAILY_COLLECTION_REQUIRED_ENV.map((name) => [name, secretMarker]));
    delete environment.SUPABASE_SERVICE_ROLE_KEY;

    expect(missingDailyCollectionConfiguration(environment)).toEqual(["SUPABASE_SERVICE_ROLE_KEY"]);
    expect(JSON.stringify(missingDailyCollectionConfiguration(environment))).not.toContain(secretMarker);
  });

  it("rejects noncanonical or non-HTTPS service URLs before the workflow curls them", () => {
    const environment = Object.fromEntries(DAILY_COLLECTION_REQUIRED_ENV.map((name) => [name, "https://example.test"]));
    environment.AWS_DEV_SITE_URL = "http://attacker.test/path";

    expect(invalidDailyCollectionConfiguration(environment)).toContain("AWS_DEV_SITE_URL");
  });

  it("prints only an allowlisted count summary and accepts only a complete collection", () => {
    const raw = {
      event: "github_daily_collection",
      complete: true,
      collectionHealth: "healthy",
      collection: {
        installationsChecked: 1,
        repositoriesChecked: 2,
        observationsStored: 3,
        repositoriesFailed: 0,
        repositoriesDeferred: 0,
        runsPartial: 0,
        privateKey: "fixture-marker-123",
      },
      materialisation: {
        runsConsidered: 4,
        materialised: 3,
        unchanged: 1,
        awaitingApproval: 0,
        needsAttention: 0,
      },
      materialisationFailed: false,
      unexpectedField: "fixture-marker-123",
    };

    const summary = sanitizeDailyCollectionRunnerLog(`collector started\n${JSON.stringify(raw)}\n`);

    expect(summary).toEqual({
      event: "github_daily_collection",
      complete: true,
      collectionHealth: "healthy",
      collection: {
        installationsChecked: 1,
        repositoriesChecked: 2,
        observationsStored: 3,
        repositoriesFailed: 0,
        repositoriesDeferred: 0,
        runsPartial: 0,
      },
      materialisation: {
        runsConsidered: 4,
        materialised: 3,
        unchanged: 1,
        awaitingApproval: 0,
        needsAttention: 0,
      },
      materialisationFailed: false,
    });
    expect(JSON.stringify(summary)).not.toContain("fixture-marker-123");
  });

  it("fails closed for absent, malformed, invalid-count, or incomplete final summaries", () => {
    expect(() => sanitizeDailyCollectionRunnerLog("ordinary runner output only\n")).toThrow(/no safe summary/);
    expect(() => sanitizeDailyCollectionRunnerLog('{"event":"github_daily_collection",\n')).toThrow(/no safe summary/);

    const valid = {
      event: "github_daily_collection",
      complete: true,
      collectionHealth: "healthy",
      collection: {
        installationsChecked: 1,
        repositoriesChecked: 1,
        observationsStored: 1,
        repositoriesFailed: 0,
        repositoriesDeferred: 0,
        runsPartial: 0,
      },
      materialisation: { runsConsidered: 1, materialised: 1, unchanged: 0, awaitingApproval: 0, needsAttention: 0 },
      materialisationFailed: false,
    };
    expect(() => sanitizeDailyCollectionRunnerLog(`${JSON.stringify(valid)}\ntrailing diagnostic output\n`)).toThrow(/no safe summary/);
    expect(() => sanitizeDailyCollectionRunnerLog(JSON.stringify({ ...valid, collection: { ...valid.collection, repositoriesChecked: -1 } }))).toThrow(/no safe summary/);
    expect(sanitizeDailyCollectionRunnerLog(JSON.stringify({ ...valid, collection: { ...valid.collection, repositoriesFailed: 1 } })).complete).toBe(false);
    expect(sanitizeDailyCollectionRunnerLog(JSON.stringify({ ...valid, materialisationFailed: true })).complete).toBe(false);
    expect(sanitizeDailyCollectionRunnerLog(JSON.stringify({ ...valid, materialisation: { ...valid.materialisation, needsAttention: 1 } })).complete).toBe(false);
  });

  it("binds scheduled and manual runs to the exact healthy App Runner image digest", () => {
    const releaseSha = "a".repeat(40);
    const digest = `sha256:${"b".repeat(64)}`;
    const input = {
      imageIdentifier: `123456789012.dkr.ecr.eu-west-2.amazonaws.com/compliancehub-dev@${digest}`,
      registry: "123456789012.dkr.ecr.eu-west-2.amazonaws.com",
      repository: "compliancehub-dev",
      liveHealth: { status: "ok", releaseSha },
      databaseHealth: { status: "ok", db: "ok" },
      ecrImageDetails: { imageDigest: digest, imageTags: [releaseSha] },
    };

    expect(resolveDailyCollectionImageBinding({ ...input, eventName: "schedule" })).toEqual({
      imageUri: input.imageIdentifier,
      imageDigest: digest,
      releaseSha,
    });
    expect(resolveDailyCollectionImageBinding({ ...input, eventName: "workflow_dispatch", expectedReleaseSha: releaseSha })).toMatchObject({ releaseSha });
    expect(() => resolveDailyCollectionImageBinding({ ...input, eventName: "workflow_dispatch", expectedReleaseSha: "c".repeat(40) })).toThrow(/binding is invalid/);
    expect(() => resolveDailyCollectionImageBinding({ ...input, ecrImageDetails: { imageDigest: `sha256:${"c".repeat(64)}`, imageTags: [releaseSha] }, eventName: "schedule" })).toThrow(/binding is invalid/);
    expect(() => resolveDailyCollectionImageBinding({ ...input, ecrImageDetails: { imageDigest: digest, imageTags: ["d".repeat(40)] }, eventName: "schedule" })).toThrow(/binding is invalid/);
    expect(() => resolveDailyCollectionImageBinding({ ...input, liveHealth: { status: "degraded", releaseSha }, eventName: "schedule" })).toThrow(/binding is invalid/);
  });

  it("sets the four-minute collector deadline below the bounded container and job timeouts", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const collector = await readFile(resolve(root, "scripts/github-compliance-collect.ts"), "utf8");

    expect(collector).toContain("SCHEDULED_COLLECTION_DEADLINE_MS = 240_000");
    expect(workflow).toContain("timeout-minutes: 12");
    expect(workflow).toContain("timeout --kill-after=10s 7m docker run");
    const containerTimeout = Number(workflow.match(/timeout --kill-after=10s (\d+)m docker run/)?.[1]);
    const jobTimeout = Number(workflow.match(/timeout-minutes: (\d+)/)?.[1]);
    expect(240_000 / 60_000).toBeLessThan(containerTimeout);
    expect(containerTimeout).toBeLessThan(jobTimeout);
  });
});
