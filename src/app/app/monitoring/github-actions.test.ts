import { beforeEach, describe, expect, it, vi } from "vitest";

const ORGANISATION_ID = "20000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000002";
const INSTALLATION_ID = "20000000-0000-4000-8000-000000000010";
const REPOSITORY_ID = "20000000-0000-4000-8000-000000000011";
const terminalRuns = [{
  collectionRunId: "20000000-0000-4000-8000-000000000012",
  organisationId: ORGANISATION_ID,
  installationId: INSTALLATION_ID,
  repositoryId: REPOSITORY_ID,
  providerRepositoryId: 71,
  status: "succeeded" as const,
}];

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  enforceRateLimit: vi.fn(),
  revalidatePath: vi.fn(),
  createServiceClient: vi.fn(),
  buildCollectionDependencies: vi.fn(),
  runGitHubCollection: vi.fn(),
  buildMaterialisationDependencies: vi.fn(),
  reconcileApprovedGitHubObservations: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: hoisted.createServiceClient }));
vi.mock("@/features/github/application/collection-deps", () => ({
  buildCollectionDependencies: hoisted.buildCollectionDependencies,
}));
vi.mock("@/features/github/application/run-collection", () => ({ runGitHubCollection: hoisted.runGitHubCollection }));
vi.mock("@/features/github/application/materialise-approved-observations", () => ({
  buildMaterialisationDependencies: hoisted.buildMaterialisationDependencies,
  reconcileApprovedGitHubObservations: hoisted.reconcileApprovedGitHubObservations,
}));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));

import { recheckGitHubInstallationAction } from "./github-actions";

function installationLookup() {
  const lookup: Record<string, ReturnType<typeof vi.fn>> = {};
  lookup.select = vi.fn(() => lookup);
  lookup.eq = vi.fn(() => lookup);
  lookup.maybeSingle = vi.fn().mockResolvedValue({
    data: { id: INSTALLATION_ID, status: "active", permissions_ok: true, repository_selection: "selected" },
    error: null,
  });
  return lookup;
}

describe("official GitHub recheck action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GITHUB_APP_ID", "123456");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "private-key");
    vi.stubEnv("GITHUB_APPROVED_SECURITY_WORKFLOW_IDS", "101,202");
    hoisted.enforceRateLimit.mockResolvedValue(undefined);
    hoisted.buildCollectionDependencies.mockReturnValue({ dependency: "collection" });
    hoisted.buildMaterialisationDependencies.mockReturnValue({ dependency: "materialisation" });
    hoisted.runGitHubCollection.mockResolvedValue({
      installationsChecked: 1,
      repositoriesChecked: 1,
      observationsStored: 15,
      repositoriesFailed: 0,
      repositoriesDeferred: 0,
      runsPartial: 0,
      terminalRuns,
    });
    hoisted.reconcileApprovedGitHubObservations.mockResolvedValue({
      runsConsidered: 1,
      materialised: 1,
      unchanged: 0,
      awaitingApproval: 0,
      needsAttention: 0,
    });
  });

  it("passes explicit official mode, reconciles terminal runs, and revalidates every affected surface", async () => {
    const lookup = installationLookup();
    const service = { from: vi.fn(), rpc: vi.fn() };
    hoisted.createServiceClient.mockReturnValue(service);
    hoisted.ctx = {
      supabase: { from: vi.fn(() => lookup) },
      user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("installationId", INSTALLATION_ID);

    await expect(recheckGitHubInstallationAction(form)).resolves.toMatchObject({
      ok: true,
      message: "Official GitHub recheck finished: 1 checked, 0 deferred, 0 failed.",
    });
    expect(hoisted.runGitHubCollection).toHaveBeenCalledWith(
      { dependency: "collection" },
      {
        trigger: "manual",
        runMode: "official",
        installationId: INSTALLATION_ID,
        requestKey: expect.stringMatching(/^manual:[0-9a-f-]{36}$/),
      },
    );
    expect(hoisted.reconcileApprovedGitHubObservations).toHaveBeenCalledWith(
      { dependency: "materialisation" },
      { limit: 100, terminalRuns },
    );
    expect(hoisted.revalidatePath.mock.calls).toEqual([
      ["/app/monitoring"],
      ["/app/evidence"],
      ["/app"],
    ]);
  });

  it.each(["admin", "member"] as const)("rejects a %s before lookup or collection", async (role) => {
    const from = vi.fn();
    hoisted.ctx = {
      supabase: { from }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role },
    };
    const form = new FormData();
    form.set("installationId", INSTALLATION_ID);

    await expect(recheckGitHubInstallationAction(form)).resolves.toEqual({
      ok: false,
      message: "Could not run this official GitHub recheck. Please try again.",
    });
    expect(from).not.toHaveBeenCalled();
    expect(hoisted.runGitHubCollection).not.toHaveBeenCalled();
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it("fails closed before collection for an unhealthy installation", async () => {
    const lookup = installationLookup();
    lookup.maybeSingle.mockResolvedValue({
      data: { id: INSTALLATION_ID, status: "active", permissions_ok: false, repository_selection: "selected" }, error: null,
    });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => lookup) },
      user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("installationId", INSTALLATION_ID);

    await expect(recheckGitHubInstallationAction(form)).resolves.toEqual({
      ok: false,
      message: "Could not run this official GitHub recheck. Please try again.",
    });
    expect(hoisted.runGitHubCollection).not.toHaveBeenCalled();
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it("fails closed before collection when GitHub grants all-repository access", async () => {
    const lookup = installationLookup();
    lookup.maybeSingle.mockResolvedValue({
      data: { id: INSTALLATION_ID, status: "active", permissions_ok: true, repository_selection: "all" }, error: null,
    });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => lookup) },
      user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("installationId", INSTALLATION_ID);

    await expect(recheckGitHubInstallationAction(form)).resolves.toEqual({
      ok: false,
      message: "Could not run this official GitHub recheck. Please try again.",
    });
    expect(lookup.select).toHaveBeenCalledWith("id,status,permissions_ok,repository_selection");
    expect(hoisted.runGitHubCollection).not.toHaveBeenCalled();
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects extra client scope fields before installation lookup", async () => {
    const from = vi.fn();
    hoisted.ctx = {
      supabase: { from }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    const form = new FormData();
    form.set("installationId", INSTALLATION_ID);
    form.set("organisationId", "20000000-0000-4000-8000-000000000099");

    await expect(recheckGitHubInstallationAction(form)).resolves.toEqual({
      ok: false,
      message: "Could not run this official GitHub recheck. Please try again.",
    });
    expect(from).not.toHaveBeenCalled();
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it("redacts provider failures from the action result", async () => {
    const lookup = installationLookup();
    hoisted.ctx = {
      supabase: { from: vi.fn(() => lookup) },
      user: { id: USER_ID }, organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };
    hoisted.createServiceClient.mockReturnValue({});
    hoisted.runGitHubCollection.mockRejectedValue(new Error("provider-sensitive-detail"));
    const form = new FormData();
    form.set("installationId", INSTALLATION_ID);

    const result = await recheckGitHubInstallationAction(form);
    expect(result).toEqual({
      ok: false,
      message: "Could not run this official GitHub recheck. Please try again.",
    });
    expect(JSON.stringify(result)).not.toContain("provider-sensitive-detail");
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });
});
