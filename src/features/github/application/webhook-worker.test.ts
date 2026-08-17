import { describe, expect, it, vi } from "vitest";

import { buildWebhookWorkerDependencies, drainGitHubWebhookDeliveries, type ClaimedWebhookDelivery, type WebhookWorkerDependencies } from "./webhook-worker";

const installationId = "11111111-1111-4111-8111-111111111111";
const repositoryId = "22222222-2222-4222-8222-222222222222";

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
    }),
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
      .mockResolvedValueOnce({ installationsChecked: 1, repositoriesChecked: 0, observationsStored: 0, repositoriesFailed: 0, repositoriesDeferred: 1, runsPartial: 0 })
      .mockResolvedValueOnce({ installationsChecked: 1, repositoriesChecked: 1, observationsStored: 15, repositoriesFailed: 1, repositoriesDeferred: 0, runsPartial: 1 });
    const result = await drainGitHubWebhookDeliveries(input, { limit: 20 });
    expect(result).toEqual({ claimed: 2, processed: 1, ignored: 0, failed: 1, ownershipLost: 0 });
    expect(input.finalise).toHaveBeenNthCalledWith(1, expect.anything(), "failed", "internal_error");
    expect(input.finalise).toHaveBeenNthCalledWith(2, second, "processed", null);
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
    input.runCollection.mockRejectedValueOnce(new Error("token body provider-id 71")).mockResolvedValueOnce({ installationsChecked: 1, repositoriesChecked: 1, observationsStored: 15, repositoriesFailed: 0, repositoriesDeferred: 0, runsPartial: 0 });
    const result = await drainGitHubWebhookDeliveries(input, { limit: 20 });
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(1);
    expect(input.finalise).toHaveBeenNthCalledWith(1, expect.anything(), "failed", "internal_error");
    expect(JSON.stringify(input.finalise.mock.calls)).not.toContain("token body");
  });

  it("rejects a claimed row whose delivery key is not the UUID accepted at intake", async () => {
    const service = {
      rpc: vi.fn().mockResolvedValue({ data: [{
        id: row().id,
        provider_delivery_id: "hostile:key",
        attempt_count: 1,
        provider_installation_id: 71,
        provider_repository_id: 91,
        installation_id: installationId,
        repository_id: repositoryId,
      }], error: null }),
    };
    const built = buildWebhookWorkerDependencies(service, {} as never);
    await expect(built.claim(20)).rejects.toThrow("GitHub webhook persistence failed");
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
    });
    const result = await drainGitHubWebhookDeliveries(input, { limit: 20 });
    expect(result.failed).toBe(1);
    expect(input.finalise).toHaveBeenCalledWith(expect.anything(), "failed", "invalid_response");
  });
});
