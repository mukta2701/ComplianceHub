import { describe, expect, it, vi } from "vitest";

import { buildWebhookWorkerDependencies, drainGitHubWebhookDeliveries, type ClaimedWebhookDelivery, type WebhookWorkerDependencies } from "./webhook-worker";

const installationId = "11111111-1111-4111-8111-111111111111";
const repositoryId = "22222222-2222-4222-8222-222222222222";
const terminalRuns = [{
  collectionRunId: "55555555-5555-4555-8555-555555555555",
  organisationId: "66666666-6666-4666-8666-666666666666",
  installationId,
  repositoryId,
  providerRepositoryId: 91,
  status: "succeeded" as const,
}];

function row(overrides: Partial<ClaimedWebhookDelivery> = {}): ClaimedWebhookDelivery {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    providerDeliveryId: "123e4567-e89b-12d3-a456-426614174000",
    attemptCount: 1,
    providerInstallationId: 71,
    providerRepositoryId: 91,
    installationId,
    repositoryId,
    ...overrides,
  };
}

function deps(rows: ClaimedWebhookDelivery[]): WebhookWorkerDependencies & {
  finalise: ReturnType<typeof vi.fn>;
  runCollection: ReturnType<typeof vi.fn>;
  reconcile: ReturnType<typeof vi.fn>;
} {
  return {
    claim: vi.fn().mockResolvedValue(rows),
    finalise: vi.fn().mockResolvedValue(true),
    runCollection: vi.fn().mockResolvedValue({
      installationsChecked: 1,
      repositoriesChecked: 1,
      observationsStored: 15,
      repositoriesFailed: 0,
      repositoriesDeferred: 0,
      runsPartial: 0,
      terminalRuns,
    }),
    reconcile: vi.fn().mockResolvedValue({ runsConsidered: 1, materialised: 1, unchanged: 0, awaitingApproval: 0, needsAttention: 0 }),
  };
}

describe("drainGitHubWebhookDeliveries", () => {
  it("claims once and runs a repository-scoped collection with a fixed delivery key", async () => {
    const input = deps([row()]);
    const result = await drainGitHubWebhookDeliveries(input, { limit: 20 });
    expect(result).toEqual({ claimed: 1, processed: 1, ignored: 0, failed: 0, ownershipLost: 0 });
    expect(input.claim).toHaveBeenCalledOnce();
    expect(input.runCollection).toHaveBeenCalledWith({
      trigger: "webhook",
      requestKey: "webhook:123e4567-e89b-12d3-a456-426614174000",
      installationId,
      repositoryId,
      signal: undefined,
    });
    expect(input.reconcile).toHaveBeenCalledWith({ limit: 100, terminalRuns });
    expect(input.runCollection.mock.invocationCallOrder[0]).toBeLessThan(input.reconcile.mock.invocationCallOrder[0]);
    expect(input.reconcile.mock.invocationCallOrder[0]).toBeLessThan(input.finalise.mock.invocationCallOrder[0]);
    expect(input.finalise).toHaveBeenCalledWith(row(), "processed", null);
  });

  it("never widens an unresolved repository event to installation scope", async () => {
    const input = deps([row({ repositoryId: null })]);
    const result = await drainGitHubWebhookDeliveries(input, { limit: 20 });
    expect(result.ignored).toBe(1);
    expect(input.runCollection).not.toHaveBeenCalled();
    expect(input.finalise).toHaveBeenCalledWith(expect.anything(), "ignored", null);
  });

  it("uses installation scope only when the provider repository ID is null", async () => {
    const input = deps([row({ providerRepositoryId: null, repositoryId: null })]);
    await drainGitHubWebhookDeliveries(input, { limit: 20 });
    expect(input.runCollection).toHaveBeenCalledWith(expect.objectContaining({ installationId, repositoryId: undefined }));
  });

  it("ignores an unresolved installation without invoking collection", async () => {
    const input = deps([row({ installationId: null, repositoryId: null })]);
    const result = await drainGitHubWebhookDeliveries(input, { limit: 20 });
    expect(result.ignored).toBe(1);
    expect(input.runCollection).not.toHaveBeenCalled();
  });

  it("leaves an active duplicate retryable and keeps processing other rows", async () => {
    const second = row({ id: "44444444-4444-4444-8444-444444444444", providerDeliveryId: "123e4567-e89b-12d3-a456-426614174001" });
    const input = deps([row(), second]);
    input.runCollection
      .mockResolvedValueOnce({ installationsChecked: 1, repositoriesChecked: 0, observationsStored: 0, repositoriesFailed: 0, repositoriesDeferred: 1, runsPartial: 0, terminalRuns: [] })
      .mockResolvedValueOnce({ installationsChecked: 1, repositoriesChecked: 1, observationsStored: 15, repositoriesFailed: 1, repositoriesDeferred: 0, runsPartial: 1, terminalRuns });
    const result = await drainGitHubWebhookDeliveries(input, { limit: 20 });
    expect(result).toEqual({ claimed: 2, processed: 1, ignored: 0, failed: 1, ownershipLost: 0 });
    expect(input.finalise).toHaveBeenNthCalledWith(1, expect.anything(), "failed", "internal_error");
    expect(input.finalise).toHaveBeenNthCalledWith(2, second, "processed", null);
  });

  it("materialises completed runs in a mixed deferred collection before leaving the webhook retryable", async () => {
    const input = deps([row()]);
    input.runCollection.mockResolvedValue({
      installationsChecked: 1,
      repositoriesChecked: 1,
      observationsStored: 15,
      repositoriesFailed: 0,
      repositoriesDeferred: 1,
      runsPartial: 0,
      terminalRuns,
    });

    const result = await drainGitHubWebhookDeliveries(input, { limit: 20 });

    expect(input.reconcile).toHaveBeenCalledWith({ limit: 100, terminalRuns });
    expect(result).toEqual({ claimed: 1, processed: 0, ignored: 0, failed: 1, ownershipLost: 0 });
    expect(input.finalise).toHaveBeenCalledWith(row(), "failed", "internal_error");
  });

  it("preserves materialisation attention for completed runs in a mixed deferred collection", async () => {
    const input = deps([row()]);
    input.runCollection.mockResolvedValue({
      installationsChecked: 1,
      repositoriesChecked: 1,
      observationsStored: 15,
      repositoriesFailed: 0,
      repositoriesDeferred: 1,
      runsPartial: 0,
      terminalRuns,
    });
    input.reconcile.mockResolvedValue({
      runsConsidered: 1, materialised: 0, unchanged: 0, awaitingApproval: 0, needsAttention: 1,
    });

    await drainGitHubWebhookDeliveries(input, { limit: 20 });

    expect(input.reconcile).toHaveBeenCalledOnce();
    expect(input.finalise).toHaveBeenCalledWith(row(), "failed", "internal_error");
  });

  it("treats a false finalizer CAS as lost ownership and exposes no identifiers", async () => {
    const input = deps([row()]);
    input.finalise.mockResolvedValue(false);
    const result = await drainGitHubWebhookDeliveries(input, { limit: 20 });
    expect(result).toEqual({ claimed: 1, processed: 0, ignored: 0, failed: 0, ownershipLost: 1 });
    expect(JSON.stringify(result)).not.toContain("123e4567");
  });

  it("maps unknown thrown failures to a safe diagnostic and processes rows independently", async () => {
    const second = row({ id: "44444444-4444-4444-8444-444444444444", providerDeliveryId: "123e4567-e89b-12d3-a456-426614174001" });
    const input = deps([row(), second]);
    input.runCollection.mockRejectedValueOnce(new Error("token body provider-id 71")).mockResolvedValueOnce({ installationsChecked: 1, repositoriesChecked: 1, observationsStored: 15, repositoriesFailed: 0, repositoriesDeferred: 0, runsPartial: 0, terminalRuns });
    const result = await drainGitHubWebhookDeliveries(input, { limit: 20 });
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(1);
    expect(input.finalise).toHaveBeenNthCalledWith(1, expect.anything(), "failed", "internal_error");
    expect(JSON.stringify(input.finalise.mock.calls)).not.toContain("token body");
  });

  it("parses claimed rows independently so malformed legacy data cannot poison a valid neighbour", async () => {
    const claimedRows = { data: [
      {
        id: row().id,
        provider_delivery_id: "has space",
        attempt_count: 1,
        provider_installation_id: 71,
        provider_repository_id: 91,
        installation_id: installationId,
        repository_id: repositoryId,
      },
      {
        id: "44444444-4444-4444-8444-444444444444",
        provider_delivery_id: "delivery:retry/v2!",
        attempt_count: 1,
        provider_installation_id: 71,
        provider_repository_id: 92,
        installation_id: installationId,
        repository_id: "55555555-5555-4555-8555-555555555555",
      },
    ], error: null };
    const service = {
      rpc: vi.fn().mockResolvedValueOnce(claimedRows).mockResolvedValue({ data: true, error: null }),
    };
    const built = buildWebhookWorkerDependencies(service, {} as never);
    built.runCollection = vi.fn().mockResolvedValue({
      installationsChecked: 1,
      repositoriesChecked: 1,
      observationsStored: 15,
      repositoriesFailed: 0,
      repositoriesDeferred: 0,
      runsPartial: 0,
      terminalRuns,
    });
    built.reconcile = vi.fn().mockResolvedValue({ runsConsidered: 1, materialised: 1, unchanged: 0, awaitingApproval: 0, needsAttention: 0 });
    const result = await drainGitHubWebhookDeliveries(built, { limit: 5 });
    expect(result).toEqual({ claimed: 2, processed: 1, ignored: 0, failed: 1, ownershipLost: 0 });
    expect(built.runCollection).toHaveBeenCalledOnce();
    expect(built.runCollection).toHaveBeenCalledWith(expect.objectContaining({ requestKey: "webhook:delivery:retry/v2!" }));
    expect(service.rpc).toHaveBeenCalledWith("finalize_github_webhook_delivery_server", expect.objectContaining({
      target_delivery_id: row().id,
      target_status: "failed",
      target_diagnostic_code: "invalid_response",
    }));
  });

  it("fails closed on a malformed collection summary", async () => {
    const input = deps([row()]);
    input.runCollection.mockResolvedValue({
      installationsChecked: 1,
      repositoriesChecked: 1,
      observationsStored: -1,
      repositoriesFailed: 0,
      repositoriesDeferred: 0,
      runsPartial: 0,
      terminalRuns: [],
    });
    const result = await drainGitHubWebhookDeliveries(input, { limit: 20 });
    expect(result.failed).toBe(1);
    expect(input.finalise).toHaveBeenCalledWith(expect.anything(), "failed", "invalid_response");
  });

  it("leaves a completed collection retryable when post-terminal materialisation needs attention", async () => {
    const input = deps([row()]);
    input.reconcile.mockResolvedValue({ runsConsidered: 1, materialised: 0, unchanged: 0, awaitingApproval: 0, needsAttention: 1 });

    const result = await drainGitHubWebhookDeliveries(input, { limit: 20 });

    expect(result).toEqual({ claimed: 1, processed: 0, ignored: 0, failed: 1, ownershipLost: 0 });
    expect(input.finalise).toHaveBeenCalledWith(row(), "failed", "internal_error");
    expect(input.runCollection).toHaveBeenCalledOnce();
  });

  it("processes the delivery when official records are only awaiting approval", async () => {
    const input = deps([row()]);
    input.reconcile.mockResolvedValue({ runsConsidered: 1, materialised: 0, unchanged: 0, awaitingApproval: 1, needsAttention: 0 });

    const result = await drainGitHubWebhookDeliveries(input, { limit: 20 });

    expect(result.processed).toBe(1);
    expect(input.finalise).toHaveBeenCalledWith(row(), "processed", null);
  });

  it("does not start an already-aborted delivery and leaves it retryable", async () => {
    const controller = new AbortController();
    controller.abort();
    const input = deps([row()]);
    const result = await drainGitHubWebhookDeliveries(input, { limit: 5, signal: controller.signal });
    expect(input.runCollection).not.toHaveBeenCalled();
    expect(input.finalise).toHaveBeenCalledWith(row(), "failed", "internal_error");
    expect(result).toEqual({ claimed: 1, processed: 0, ignored: 0, failed: 1, ownershipLost: 0 });
  });

  it("checks abort after each delivery and never marks aborted work processed", async () => {
    const controller = new AbortController();
    const second = row({ id: "44444444-4444-4444-8444-444444444444", providerDeliveryId: "delivery-two" });
    const input = deps([row(), second]);
    input.runCollection.mockImplementationOnce(async () => {
      controller.abort();
      return { installationsChecked: 1, repositoriesChecked: 1, observationsStored: 15, repositoriesFailed: 0, repositoriesDeferred: 0, runsPartial: 0, terminalRuns };
    });
    const result = await drainGitHubWebhookDeliveries(input, { limit: 5, signal: controller.signal });
    expect(input.runCollection).toHaveBeenCalledOnce();
    expect(input.finalise).toHaveBeenNthCalledWith(1, row(), "failed", "internal_error");
    expect(input.finalise).toHaveBeenNthCalledWith(2, second, "failed", "internal_error");
    expect(result).toEqual({ claimed: 2, processed: 0, ignored: 0, failed: 2, ownershipLost: 0 });
  });
});
