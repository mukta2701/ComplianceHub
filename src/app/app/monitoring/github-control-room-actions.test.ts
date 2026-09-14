import { beforeEach, describe, expect, it, vi } from "vitest";

import { STANDARD_GITHUB_ISO_MAPPING_PACK } from "@/features/github/domain/mapping";

const ORG = "a1000000-0000-4000-8000-000000000001";
const USER = "a1000000-0000-4000-8000-000000000002";
const PACK = "91000000-0000-4000-8000-000000000001";
const APPROVAL = "a1000000-0000-4000-8000-000000000003";
const REPOSITORY = "a1000000-0000-4000-8000-000000000004";
const RUN = "a1000000-0000-4000-8000-000000000005";
const JOB = "a1000000-0000-4000-8000-000000000006";
const INSTALLATION = "a1000000-0000-4000-8000-000000000007";

const hoisted = vi.hoisted(() => ({
  role: "owner" as "owner" | "admin" | "member",
  rows: {} as Record<string, { data: unknown; error: unknown }>,
  calls: [] as string[],
  rateLimit: vi.fn(),
  serviceRpc: vi.fn(),
  reconcile: vi.fn(),
  buildDeps: vi.fn(),
  retry: vi.fn(),
  revalidate: vi.fn(),
}));

function sessionClient() {
  return {
    from(table: string) {
      hoisted.calls.push(`from:${table}`);
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "not", "in"]) {
        query[method] = (...args: unknown[]) => {
          hoisted.calls.push(`${table}:${method}:${JSON.stringify(args)}`);
          return query;
        };
      }
      query.maybeSingle = () => Promise.resolve(hoisted.rows[table] ?? { data: null, error: null });
      return query;
    },
  };
}

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    supabase: sessionClient(),
    organisation: { id: ORG },
    user: { id: USER },
    membership: { role: hoisted.role },
  }),
}));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: (...args: unknown[]) => {
  hoisted.calls.push("rate-limit");
  return hoisted.rateLimit(...args);
} }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => {
  hoisted.calls.push("service-client");
  return { rpc: hoisted.serviceRpc };
} }));
vi.mock("@/features/github/application/materialise-approved-observations", () => ({
  buildMaterialisationDependencies: (...args: unknown[]) => hoisted.buildDeps(...args),
  reconcileApprovedGitHubObservations: (...args: unknown[]) => hoisted.reconcile(...args),
}));
vi.mock("@/features/github/application/github-compliance-control-room", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/github/application/github-compliance-control-room")>();
  return { ...original, retryGitHubMaterialisationJob: (...args: unknown[]) => hoisted.retry(...args) };
});
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidate }));

import {
  approveGitHubMappingPackAction,
  processApprovedGitHubResultsAction,
  retryExhaustedGitHubMaterialisationAction,
  revokeGitHubMappingApprovalAction,
} from "./github-control-room-actions";

function approvalForm() {
  const form = new FormData();
  form.set("version", STANDARD_GITHUB_ISO_MAPPING_PACK.version);
  form.set("checksum", STANDARD_GITHUB_ISO_MAPPING_PACK.checksum);
  form.set("confirmation", "accepted");
  return form;
}

function targetForm(includeReason = false) {
  const form = new FormData();
  form.set("repositoryId", REPOSITORY);
  form.set("collectionRunId", RUN);
  form.set("jobId", JOB);
  if (includeReason) form.set("reasonCode", "configuration_corrected");
  return form;
}

describe("GitHub control-room actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.calls.length = 0;
    hoisted.role = "owner";
    hoisted.rows = {
      github_mapping_packs: { data: {
        id: PACK,
        version: STANDARD_GITHUB_ISO_MAPPING_PACK.version,
        checksum: STANDARD_GITHUB_ISO_MAPPING_PACK.checksum,
        published_at: "2026-08-24T12:00:00.000Z",
      }, error: null },
      github_mapping_approvals: { data: { id: APPROVAL, mapping_pack_id: PACK }, error: null },
      github_collection_runs: { data: {
        id: RUN, organisation_id: ORG, installation_id: INSTALLATION,
        repository_id: REPOSITORY, provider_repository_id: 71, status: "succeeded",
      }, error: null },
      github_materialisation_jobs: { data: {
        id: JOB, organisation_id: ORG, repository_id: REPOSITORY,
        collection_run_id: RUN, status: "pending",
      }, error: null },
    };
    hoisted.rateLimit.mockResolvedValue(undefined);
    hoisted.serviceRpc.mockResolvedValue({ data: APPROVAL, error: null });
    hoisted.buildDeps.mockReturnValue({ dependency: "materialisation" });
    hoisted.reconcile.mockResolvedValue({
      runsConsidered: 1, materialised: 1, unchanged: 0, awaitingApproval: 0, needsAttention: 0,
    });
    hoisted.retry.mockResolvedValue(true);
  });

  it.each(["admin", "member"] as const)("rejects %s before approval preflight, rate limiting, or service access", async (role) => {
    hoisted.role = role;
    await expect(approveGitHubMappingPackAction(approvalForm())).resolves.toEqual({
      ok: false,
      message: "Only a workspace Owner can approve GitHub compliance mappings.",
    });
    expect(hoisted.calls).toEqual([]);
    expect(hoisted.rateLimit).not.toHaveBeenCalled();
    expect(hoisted.serviceRpc).not.toHaveBeenCalled();
  });

  it.each(["admin", "member"] as const)("keeps every official-processing action Owner-only for %s", async (role) => {
    hoisted.role = role;
    const revokeForm = new FormData();
    revokeForm.set("approvalId", APPROVAL);

    await expect(revokeGitHubMappingApprovalAction(revokeForm)).resolves.toEqual({
      ok: false, message: "Only a workspace Owner can revoke GitHub compliance mappings.",
    });
    await expect(processApprovedGitHubResultsAction(targetForm())).resolves.toEqual({
      ok: false, message: "Only a workspace Owner can process official GitHub records.",
    });
    await expect(retryExhaustedGitHubMaterialisationAction(targetForm(true))).resolves.toEqual({
      ok: false, message: "Only a workspace Owner can retry GitHub processing.",
    });
    expect(hoisted.calls).toEqual([]);
    expect(hoisted.rateLimit).not.toHaveBeenCalled();
    expect(hoisted.retry).not.toHaveBeenCalled();
  });

  it("requires the exact disclaimer confirmation before database work", async () => {
    const form = approvalForm();
    form.set("confirmation", "yes");
    await expect(approveGitHubMappingPackAction(form)).resolves.toEqual({
      ok: false,
      message: "Review and confirm the GitHub mapping limitations before approval.",
    });
    expect(hoisted.calls).toEqual([]);
  });

  it("rejects a stale pack identity before rate limiting or creating a service client", async () => {
    hoisted.rows.github_mapping_packs = { data: null, error: null };
    await expect(approveGitHubMappingPackAction(approvalForm())).resolves.toEqual({
      ok: false,
      message: "The reviewed GitHub mapping version changed. Refresh and review it again.",
    });
    expect(hoisted.calls).not.toContain("rate-limit");
    expect(hoisted.calls).not.toContain("service-client");
  });

  it("approves only the exact published pack after org/user rate limiting", async () => {
    const result = await approveGitHubMappingPackAction(approvalForm());
    expect(result).toEqual({ ok: true, message: "GitHub mapping approved. Official records can now be processed." });
    expect(hoisted.rateLimit).toHaveBeenCalledWith(`github-mapping-approval:${ORG}:${USER}`, { limit: 5, windowMs: 60_000 });
    expect(hoisted.serviceRpc).toHaveBeenCalledWith("approve_github_mapping_pack_server", {
      target_organisation_id: ORG,
      target_actor_id: USER,
      target_version: STANDARD_GITHUB_ISO_MAPPING_PACK.version,
      target_checksum: STANDARD_GITHUB_ISO_MAPPING_PACK.checksum,
    });
    expect(hoisted.calls.indexOf("rate-limit")).toBeLessThan(hoisted.calls.indexOf("service-client"));
    expect(hoisted.revalidate.mock.calls).toEqual([["/app/monitoring"]]);
  });

  it("revokes only the active approval in the current workspace", async () => {
    const form = new FormData();
    form.set("approvalId", APPROVAL);
    hoisted.serviceRpc.mockResolvedValue({ data: true, error: null });
    await expect(revokeGitHubMappingApprovalAction(form)).resolves.toEqual({
      ok: true, message: "GitHub mapping approval revoked. Existing records remain historical.",
    });
    expect(hoisted.calls).toContain(`github_mapping_approvals:eq:["organisation_id","${ORG}"]`);
    expect(hoisted.serviceRpc).toHaveBeenCalledWith("revoke_github_mapping_approval_server", {
      target_organisation_id: ORG,
      target_actor_id: USER,
      target_approval_id: APPROVAL,
    });
    expect(hoisted.revalidate.mock.calls).toEqual([["/app/monitoring"]]);
  });

  it("rejects a sibling-workspace approval before service access", async () => {
    hoisted.rows.github_mapping_approvals = { data: null, error: null };
    const form = new FormData();
    form.set("approvalId", APPROVAL);
    await expect(revokeGitHubMappingApprovalAction(form)).resolves.toEqual({
      ok: false, message: "Could not revoke this GitHub mapping approval.",
    });
    expect(hoisted.calls).not.toContain("service-client");
  });

  it("processes exactly one scoped terminal run and its current job", async () => {
    await expect(processApprovedGitHubResultsAction(targetForm())).resolves.toEqual({
      ok: true, message: "Official GitHub records processed: 1 run updated.",
    });
    expect(hoisted.reconcile).toHaveBeenCalledWith({ dependency: "materialisation" }, {
      limit: 1,
      terminalRuns: [{
        collectionRunId: RUN,
        organisationId: ORG,
        installationId: INSTALLATION,
        repositoryId: REPOSITORY,
        providerRepositoryId: 71,
        status: "succeeded",
      }],
    });
    expect(hoisted.calls).toContain(`github_materialisation_jobs:eq:["collection_run_id","${RUN}"]`);
    expect(hoisted.calls.indexOf(`github_materialisation_jobs:eq:["collection_run_id","${RUN}"]`))
      .toBeLessThan(hoisted.calls.indexOf("rate-limit"));
    expect(hoisted.calls.indexOf("rate-limit")).toBeLessThan(hoisted.calls.indexOf("service-client"));
    expect(hoisted.revalidate.mock.calls).toEqual([
      ["/app/monitoring"],
      ["/app/evidence"],
      ["/app"],
    ]);
  });

  it("does not create a service client for malformed or cross-workspace processing targets", async () => {
    const malformed = targetForm();
    malformed.set("jobId", "not-a-uuid");
    await expect(processApprovedGitHubResultsAction(malformed)).resolves.toEqual({
      ok: false, message: "Could not process these GitHub results.",
    });
    expect(hoisted.calls).not.toContain("service-client");

    hoisted.rows.github_collection_runs = { data: null, error: null };
    await expect(processApprovedGitHubResultsAction(targetForm())).resolves.toEqual({
      ok: false, message: "Could not process these GitHub results.",
    });
    expect(hoisted.calls).not.toContain("service-client");
    expect(hoisted.revalidate).not.toHaveBeenCalled();
  });

  it("does not invalidate operator surfaces when official processing fails", async () => {
    hoisted.reconcile.mockRejectedValue(new Error("materialisation failed"));
    await expect(processApprovedGitHubResultsAction(targetForm())).resolves.toEqual({
      ok: false, message: "Could not process these GitHub results.",
    });
    expect(hoisted.revalidate).not.toHaveBeenCalled();
  });

  it("retries an exact exhausted job using only a closed reason code", async () => {
    hoisted.rows.github_materialisation_jobs = { data: {
      id: JOB, organisation_id: ORG, repository_id: REPOSITORY,
      collection_run_id: RUN, status: "exhausted",
    }, error: null };
    await expect(retryExhaustedGitHubMaterialisationAction(targetForm(true))).resolves.toEqual({
      ok: true, message: "GitHub processing retry queued.",
    });
    expect(hoisted.retry).toHaveBeenCalledWith(expect.any(Function), {
      organisationId: ORG,
      actorId: USER,
      jobId: JOB,
      reasonCode: "configuration_corrected",
    });
    expect(hoisted.rateLimit.mock.invocationCallOrder[0]).toBeLessThan(hoisted.retry.mock.invocationCallOrder[0]);
    expect(hoisted.revalidate.mock.calls).toEqual([["/app/monitoring"]]);
  });

  it("maps rate-limit and internal details to stable safe errors", async () => {
    hoisted.rateLimit.mockRejectedValue(new Error("private limiter detail"));
    const result = await approveGitHubMappingPackAction(approvalForm());
    expect(result).toEqual({ ok: false, message: "Could not approve the GitHub mapping right now." });
    expect(JSON.stringify(result)).not.toContain("private limiter detail");
    expect(hoisted.calls).not.toContain("service-client");
    expect(hoisted.revalidate).not.toHaveBeenCalled();
  });
});
