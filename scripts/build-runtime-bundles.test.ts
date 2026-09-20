// @vitest-environment node
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it, vi } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "..");
const runtimePath = resolve(repositoryRoot, "dist/github-connection-reconcile.mjs");
const fixtureSecret = "task8-fixture-secret-must-not-leak";
const fixtureEncryptionMarker = "task8-fixture-encryption-marker";
const fixtureSlackDigestMarker = "task8-fixture-slack-digest-marker";
const executionId = "81000000-0000-4000-8000-000000000001";
const runId = "81000000-0000-4000-8000-000000000002";
const installationId = "81000000-0000-4000-8000-000000000003";
const organisationId = "81000000-0000-4000-8000-000000000004";

type BuiltRuntime = {
  runGitHubConnectionReconcile(input: {
    environment: Record<string, string | undefined>;
    executionId: string;
    dependencies: {
      getConfig(environment: Record<string, string | undefined>): {
        appId: string;
        appSlug: string;
        clientId: string;
        clientSecret: string;
        privateKey: string;
        webhookSecret: string;
        allowedAccountId: number;
        allowedAccountType: "Organization";
      };
      createServiceClient(): unknown;
      createAppJwt(): Promise<string>;
      createInstallationToken(): Promise<{ token: string; expiresAt: string }>;
      readInstallationSnapshot(): Promise<unknown>;
      runCycle?(dependencies: {
        claimDueInstallations(limit: number): Promise<Array<{ installationUuid: string }>>;
        loadInstallationContext(installationUuid: string): Promise<{ providerInstallationId: number }>;
      }, input: { executionId: string }): Promise<{
        executionId: string;
        webhookDeliveriesClaimed: number;
        installationsClaimed: number;
        healthy: number;
        retrying: number;
        actionRequired: number;
        recovered: number;
        ownershipLost: number;
      }>;
      drainSlackDeliveries(
        service: unknown,
        batchSize: number,
        signal: AbortSignal,
      ): Promise<{ claimed: number; delivered: number; failed: number }>;
      now(): Date;
    };
  }): Promise<{ executionId: string; summary: { installationsClaimed: number; healthy: number } }>;
  runGitHubConnectionReconcileCli(input: {
    environment: Record<string, string | undefined>;
    dependencies: {
      getConfig(): never;
    };
    stdout(value: string): void;
    stderr(value: string): void;
  }): Promise<number>;
};

async function buildRuntime(): Promise<BuiltRuntime> {
  const result = await execFileAsync("npm", ["run", "build:runtimes"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  expect(result.stdout).toContain("build:runtimes");
  await access(runtimePath);
  await expect(access(`${runtimePath}.map`)).rejects.toThrow();
  const source = await readFile(runtimePath, "utf8");
  expect(source).not.toContain("sourceMappingURL");
  expect(source).not.toContain(fixtureSecret);
  expect(source).not.toContain(fixtureEncryptionMarker);
  expect(source).not.toContain(fixtureSlackDigestMarker);
  return import(`${pathToFileURL(runtimePath).href}?test=${Date.now()}`) as Promise<BuiltRuntime>;
}

describe.sequential("production runtime bundles", () => {
  it("builds the finite runner and executes one populated fictional cycle with the real cycle algorithm", async () => {
    const runtime = await buildRuntime();
    const from = vi.fn((table: string) => ({
      select: (columns: string) => ({
        eq: () => {
          const data = table === "github_repositories"
            ? columns.includes("selected")
              ? [{ provider_repository_id: 101, selected: true, available: true }]
              : [{ provider_repository_id: 101, full_name: "fictional-company/repository" }]
            : [];
          const query = Promise.resolve({ data, error: null }) as Promise<{ data: unknown; error: null }> & {
            single(): Promise<{ data: unknown; error: null }>;
          };
          query.single = async () => ({
            data: table === "github_installations" ? {
              provider_installation_id: 42,
              organisation_id: organisationId,
              health: "healthy",
              consecutive_reconciliation_failures: 0,
              account_id: 99,
              account_login: "fictional-company",
              account_type: "Organization",
            } : null,
            error: null,
          });
          return query;
        },
      }),
    }));
    const service = {
      rpc: vi.fn(async (name: string) => {
        if (name === "claim_due_github_connection_reconciliations_server") {
          return {
            data: [{ id: runId, organisation_id: organisationId, installation_id: installationId }],
            error: null,
          };
        }
        if (name === "finalize_github_connection_reconciliation_server") {
          return { data: "none", error: null };
        }
        return { data: [], error: null };
      }),
      from,
    };

    const drainSlackDeliveries = vi.fn().mockResolvedValue({ claimed: 0, delivered: 0, failed: 0 });
    const result = await runtime.runGitHubConnectionReconcile({
      environment: {},
      executionId,
      dependencies: {
        getConfig: () => ({
          appId: "1",
          appSlug: "fictional-app",
          clientId: "fictional-client",
          clientSecret: fixtureSecret,
          privateKey: fixtureSecret,
          webhookSecret: fixtureSecret,
          allowedAccountId: 99,
          allowedAccountType: "Organization",
        }),
        createServiceClient: () => service,
        createAppJwt: async () => "fictional-app-jwt",
        createInstallationToken: async () => ({
          token: "fictional-installation-token",
          expiresAt: "2026-09-19T13:00:00.000Z",
        }),
        readInstallationSnapshot: async () => ({
          installationId: 42,
          account: { id: 99, login: "fictional-company", type: "Organization" },
          repositorySelection: "selected",
          permissions: {
            actions: "read",
            administration: "read",
            metadata: "read",
            secret_scanning_alerts: "read",
            security_events: "read",
            vulnerability_alerts: "read",
          },
          suspendedAt: null,
          repositories: [{
            id: 101,
            owner: "fictional-company",
            name: "repository",
            fullName: "fictional-company/repository",
            htmlUrl: "https://github.com/fictional-company/repository",
            visibility: "private",
            archived: false,
            defaultBranch: "main",
          }],
        }),
        drainSlackDeliveries,
        now: () => new Date("2026-09-19T12:00:00.000Z"),
      },
    });

    expect(result).toEqual({
      executionId,
      summary: expect.objectContaining({ installationsClaimed: 1, healthy: 1 }),
    });
    expect(from).toHaveBeenCalledWith("github_installations");
    expect(drainSlackDeliveries).toHaveBeenCalledTimes(1);
    expect(service.rpc).toHaveBeenCalledWith(
      "finalize_github_connection_reconciliation_server",
      expect.objectContaining({ target_outcome: "success" }),
    );
  });

  it("runs the exact bundled command once and exits without exposing fictional secrets", async () => {
    await buildRuntime();
    const requests: string[] = [];
    const server = createServer((request, response) => {
      requests.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end("[]");
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture server did not bind a TCP port");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

    try {
      const result = await execFileAsync(process.execPath, [runtimePath], {
        cwd: repositoryRoot,
        encoding: "utf8",
        timeout: 8_000,
        env: {
          ...process.env,
          NODE_ENV: "development",
          NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
          NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${address.port}`,
          SUPABASE_SERVICE_ROLE_KEY: fixtureSecret,
          GITHUB_APP_ID: "1",
          GITHUB_APP_SLUG: "fictional-app",
          GITHUB_APP_CLIENT_ID: "fictional-client",
          GITHUB_APP_CLIENT_SECRET: fixtureSecret,
          GITHUB_APP_PRIVATE_KEY: privateKeyPem,
          GITHUB_WEBHOOK_SECRET: fixtureSecret,
          GITHUB_ALLOWED_ACCOUNT_ID: "99",
          GITHUB_ALLOWED_ACCOUNT_TYPE: "User",
          GITHUB_CONNECTION_MAX_WEBHOOK_DELIVERIES: "1",
          GITHUB_CONNECTION_MAX_INSTALLATIONS: "1",
          GITHUB_CONNECTION_MAX_SLACK_DELIVERIES: "1",
          GITHUB_CONNECTION_TIME_BUDGET_MS: "5000",
          APP_ENCRYPTION_KEY: "task8-fixture-encryption-marker",
          SLACK_ALLOWED_WEBHOOK_SHA256: "task8-fixture-slack-digest-marker",
        },
      });

      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("webhookDeliveriesClaimed=0 installationsClaimed=0");
      expect(`${result.stdout}${result.stderr}`).not.toContain(fixtureSecret);
      expect(requests).toEqual(expect.arrayContaining([
        "/rest/v1/rpc/claim_github_connection_webhook_deliveries_server",
        "/rest/v1/rpc/claim_due_github_connection_reconciliations_server",
        "/rest/v1/rpc/claim_github_connection_alert_delivery",
      ]));
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
    }
  });

  it("keeps arbitrary dependency errors and secrets out of CLI output", async () => {
    const runtime = await buildRuntime();
    const stdout = vi.fn();
    const stderr = vi.fn();
    const exitCode = await runtime.runGitHubConnectionReconcileCli({
      environment: {},
      dependencies: {
        getConfig: () => { throw new Error(`provider body ${fixtureSecret}`); },
      },
      stdout,
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/^github-connection-reconcile execution=[0-9a-f-]+ failed\n$/));
    expect(JSON.stringify(stderr.mock.calls)).not.toContain(fixtureSecret);
  });
});
