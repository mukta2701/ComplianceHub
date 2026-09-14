// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { buildLocalGitHubShadowProofInput } from "./github-shadow-proof-local";

const protectedStateJson = JSON.stringify({
  materialisationJobs: { count: 0, sha256: "0".repeat(64) },
  officialResults: { count: 0, sha256: "0".repeat(64) },
  githubEvidenceProvenance: { count: 0, sha256: "0".repeat(64) },
  githubFindingProvenance: { count: 0, sha256: "0".repeat(64) },
  evidenceAndFindings: { count: 0, sha256: "0".repeat(64) },
  readinessSoaAssessmentRisk: { count: 0, sha256: "0".repeat(64) },
  githubMappingApprovalLineage: { count: 0, sha256: "0".repeat(64) },
  mcpDigest: { count: 1, sha256: "0".repeat(64) },
  slackDeliveries: { count: 0, sha256: "0".repeat(64) },
});

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
  GITHUB_APP_ID: "123",
  GITHUB_APP_PRIVATE_KEY: "fixture-key",
  GITHUB_ALLOWED_ACCOUNT_ID: "61040544",
  GITHUB_ALLOWED_ACCOUNT_TYPE: "User",
  GITHUB_APPROVED_SECURITY_WORKFLOW_IDS: "31",
};
const approvedDockerEndpoint = "unix:///Users/m1ghty/.colima/default/docker.sock";

describe("buildLocalGitHubShadowProofInput", () => {
  it("binds every database read to the exact local container identity and parses only JSON summaries", async () => {
    const execute = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args[0] === "context" && args[1] === "show") return "colima\n";
      if (args[0] === "context" && args[1] === "inspect") return `${approvedDockerEndpoint}\n`;
      if (args[0] === "--host" && args[1] === approvedDockerEndpoint && args[2] === "inspect") {
        return "/supabase_db_compliancehub|compliancehub|compliancehub\n";
      }
      const sql = args.at(-1) ?? "";
      if (sql.includes("activeInstallationCount")) return JSON.stringify({
        activeInstallationCount: 1,
        repositories: [{
          organisationId: "00000000-0000-4000-8000-000000000001",
          installationId: "00000000-0000-4000-8000-000000000002",
          repositoryId: "00000000-0000-4000-8000-000000000003",
          providerInstallationId: 154509880,
          providerRepositoryId: 101,
          accountId: 61040544,
          accountLogin: "mukta2701",
          accountType: "User",
          installationStatus: "active",
          permissionsOk: true,
          owner: "mukta2701",
          name: "ComplianceHub",
          selected: true,
          available: true,
        }],
      });
      if (sql.includes("github_collection_runs")) return JSON.stringify({ runMode: "shadow", status: "succeeded", observationCount: 15, materialisationJobCount: 0 });
      return protectedStateJson;
    });
    const input = buildLocalGitHubShadowProofInput(env, { execute });

    await expect(input.inspectLocalTarget()).resolves.toBe("supabase_db_compliancehub");
    await expect(input.loadScope()).resolves.toHaveLength(1);
    await expect(input.captureProtectedState({
      organisationId: "00000000-0000-4000-8000-000000000001",
      localDate: "2026-09-01",
    })).resolves.toMatchObject({ materialisationJobs: { count: 0 }, mcpDigest: { count: 1 } });
    await expect(input.inspectShadowOutcome("00000000-0000-4000-8000-000000000004")).resolves.toMatchObject({ runMode: "shadow", observationCount: 15 });
    expect(execute.mock.calls.every(([file]) => file === "docker")).toBe(true);
    expect(execute.mock.calls.slice(0, 3)).toEqual([
      ["docker", ["context", "show"]],
      ["docker", ["context", "inspect", "--format", '{{(index .Endpoints "docker").Host}}', "colima"]],
      ["docker", ["--host", approvedDockerEndpoint, "inspect", "--format", '{{.Name}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.supabase.cli.project"}}', "supabase_db_compliancehub"]],
    ]);
    expect(execute).toHaveBeenCalledWith("docker", ["--host", approvedDockerEndpoint, "inspect", "--format", '{{.Name}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.supabase.cli.project"}}', "supabase_db_compliancehub"]);
    const psqlCalls = execute.mock.calls.filter(([, args]) => args[0] === "--host" && args[2] === "exec");
    expect(psqlCalls).toHaveLength(3);
    expect(psqlCalls.every(([, args]) => args[1] === approvedDockerEndpoint && args[3] === "supabase_db_compliancehub" && args.includes("--no-psqlrc"))).toBe(true);
    expect(execute.mock.calls.some(([, args]) => args[0] === "inspect" || args[0] === "exec")).toBe(false);
    const sqlStatements = execute.mock.calls.map(([, args]) => args.at(-1) ?? "").join("\n");
    expect(sqlStatements).toContain("public.tasks");
    expect(sqlStatements).toContain("githubMappingApprovalLineage");
    expect(sqlStatements).toContain("public.github_mapping_approvals");
    expect(sqlStatements).toContain("public.get_mcp_compliance_bundle_v2");
    expect(sqlStatements).toContain("#- '{github,asOf}'");
    expect(sqlStatements).toContain("'00000000-0000-4000-8000-000000000001'::uuid");
    expect(sqlStatements).toContain("'2026-09-01'::date");
  });

  it("fails closed on a lookalike container identity", async () => {
    const execute = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args[0] === "context" && args[1] === "show") return "colima\n";
      if (args[0] === "context" && args[1] === "inspect") return `${approvedDockerEndpoint}\n`;
      return "/supabase_db_compliancehub|other|compliancehub\n";
    });
    const input = buildLocalGitHubShadowProofInput(env, { execute });

    await expect(input.inspectLocalTarget()).rejects.toThrow("GitHub shadow proof local target denied");
  });

  it.each(["DOCKER_HOST", "DOCKER_CONTEXT"])("rejects ambient %s before any command I/O", (variable) => {
    const execute = vi.fn();
    expect(() => buildLocalGitHubShadowProofInput({ ...env, [variable]: "remote" }, { execute }))
      .toThrow("GitHub shadow proof local configuration denied");
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ["remote active context", "production", approvedDockerEndpoint],
    ["remote effective endpoint", "colima", "tcp://remote.example:2376"],
  ])("rejects %s before container/database I/O", async (_label, activeContext, endpoint) => {
    const execute = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args[0] === "context" && args[1] === "show") return `${activeContext}\n`;
      if (args[0] === "context" && args[1] === "inspect") return `${endpoint}\n`;
      throw new Error("container I/O must not run");
    });
    const input = buildLocalGitHubShadowProofInput(env, { execute });

    await expect(input.inspectLocalTarget()).rejects.toThrow("GitHub shadow proof local target denied");
    expect(execute.mock.calls.some(([, args]) => args[0] === "inspect" || args[0] === "exec")).toBe(false);
  });

  it("keeps every cached-guard container operation bound to the approved socket after ambient context changes", async () => {
    let ambientContext = "colima";
    const execute = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args[0] === "context" && args[1] === "show") return `${ambientContext}\n`;
      if (args[0] === "context" && args[1] === "inspect") return `${approvedDockerEndpoint}\n`;
      if (args[0] !== "--host" || args[1] !== approvedDockerEndpoint) {
        throw new Error("unbound container command");
      }
      if (args[2] === "inspect") return "/supabase_db_compliancehub|compliancehub|compliancehub\n";
      if (args[2] === "exec") return JSON.stringify({
        activeInstallationCount: 1,
        repositories: [{ repository: "bounded-fixture" }],
      });
      throw new Error("unexpected command");
    });
    const input = buildLocalGitHubShadowProofInput(env, { execute });

    await expect(input.inspectLocalTarget()).resolves.toBe("supabase_db_compliancehub");
    ambientContext = "remote-production";
    await expect(input.loadScope()).resolves.toHaveLength(1);
    expect(execute.mock.calls.filter(([, args]) => args[0] === "context" && args[1] === "show")).toHaveLength(1);
    expect(execute.mock.calls.filter(([, args]) => args[0] === "--host").every(([, args]) => args[1] === approvedDockerEndpoint)).toBe(true);
  });

  it("requires one active allowed installation independently of selected repository count", async () => {
    const execute = vi.fn(async (_file: string, args: readonly string[]) => {
      if (args[0] === "context" && args[1] === "show") return "colima\n";
      if (args[0] === "context" && args[1] === "inspect") return `${approvedDockerEndpoint}\n`;
      if (args[0] === "--host" && args[1] === approvedDockerEndpoint && args[2] === "inspect") {
        return "/supabase_db_compliancehub|compliancehub|compliancehub\n";
      }
      return JSON.stringify({ activeInstallationCount: 2, repositories: [{}] });
    });
    const input = buildLocalGitHubShadowProofInput(env, { execute });

    await expect(input.loadScope()).rejects.toThrow("GitHub shadow proof local state denied");
  });

  it.each([
    ["remote URL", { NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" }],
    ["organisation mode", { GITHUB_ALLOWED_ACCOUNT_TYPE: "Organization" }],
    ["missing service key", { SUPABASE_SERVICE_ROLE_KEY: "" }],
  ])("rejects %s before constructing the local runner", (_label, override) => {
    expect(() => buildLocalGitHubShadowProofInput({ ...env, ...override }, { execute: vi.fn() })).toThrow("GitHub shadow proof local configuration denied");
  });
});
