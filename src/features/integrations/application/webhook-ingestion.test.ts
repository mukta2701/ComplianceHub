import { describe, expect, it, vi } from "vitest";
import { createSupabaseNativeWebhookStore } from "./webhook-ingestion";

const connectionRow = {
  id: "10000000-0000-4000-8000-000000000001",
  organisation_id: "10000000-0000-4000-8000-000000000002",
  provider: "github",
};

function query(result: { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => result);
  return builder;
}

describe("Supabase native webhook adapter", () => {
  it("resolves GitHub only through active native installation filters", async () => {
    const builder = query({ data: connectionRow, error: null });
    const database = { from: vi.fn(() => builder), rpc: vi.fn() };
    const store = createSupabaseNativeWebhookStore(database);

    await expect(store.findActiveGitHubConnection("91001")).resolves.toEqual({
      id: connectionRow.id,
      organisationId: connectionRow.organisation_id,
      provider: "github",
    });
    expect(builder.eq.mock.calls).toEqual(expect.arrayContaining([
      ["provider", "github"],
      ["connection_mode", "github_app"],
      ["provider_account_id", "91001"],
      ["enabled", true],
    ]));
    expect(builder.is).toHaveBeenCalledWith("revoked_at", null);
  });

  it("uses only the narrow Jira hash resolver and parses an active identity", async () => {
    const rpc = vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({
      data: [{ ...connectionRow, provider: "jira", jira_webhook_id: "71001" }],
      error: null,
    }));
    const store = createSupabaseNativeWebhookStore({ from: vi.fn(), rpc });
    const hash = "a".repeat(64);

    await expect(store.findActiveJiraConnection(hash)).resolves.toEqual({
      id: connectionRow.id,
      organisationId: connectionRow.organisation_id,
      provider: "jira",
      jiraWebhookId: "71001",
    });
    expect(rpc).toHaveBeenCalledWith("resolve_active_jira_webhook_connection", {
      candidate_callback_hash: hash,
    });
  });

  it("binds targets to the resolved organisation, connection, and provider", async () => {
    const target = {
      id: "10000000-0000-4000-8000-000000000003",
      organisation_id: connectionRow.organisation_id,
      connection_id: connectionRow.id,
      provider: "github",
      external_id: "22001",
    };
    const builder = query({ data: target, error: null });
    const store = createSupabaseNativeWebhookStore({ from: vi.fn(() => builder), rpc: vi.fn() });

    await expect(store.findActiveTarget({
      id: connectionRow.id, organisationId: connectionRow.organisation_id, provider: "github",
    }, "22001")).resolves.toEqual({ id: target.id });
    expect(builder.eq.mock.calls).toEqual(expect.arrayContaining([
      ["organisation_id", connectionRow.organisation_id],
      ["connection_id", connectionRow.id],
      ["provider", "github"],
      ["external_id", "22001"],
      ["enabled", true],
    ]));
    expect(builder.is).toHaveBeenCalledWith("revoked_at", null);
  });

  it("calls the atomic record-and-enqueue RPC with minimized metadata and rejects malformed results", async () => {
    const rpc = vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({
      data: [{
        delivery_id: "10000000-0000-4000-8000-000000000004",
        job_id: "10000000-0000-4000-8000-000000000005",
        created: true,
      }],
      error: null,
    }));
    const store = createSupabaseNativeWebhookStore({ from: vi.fn(), rpc });
    const input = {
      connection: { id: connectionRow.id, organisationId: connectionRow.organisation_id, provider: "github" as const },
      targetId: null,
      deliveryKey: "delivery-one",
      eventType: "installation_repositories",
      deliveryPayload: { repositoryId: null },
      payloadHash: "b".repeat(64),
      kind: "connection_reconciliation" as const,
      jobPayload: { eventType: "installation_repositories" },
    };

    await expect(store.recordAndEnqueue(input)).resolves.toEqual({
      deliveryId: "10000000-0000-4000-8000-000000000004",
      jobId: "10000000-0000-4000-8000-000000000005",
      created: true,
    });
    expect(rpc).toHaveBeenCalledWith("record_integration_webhook_and_enqueue", expect.objectContaining({
      target_organisation_id: connectionRow.organisation_id,
      target_connection_id: connectionRow.id,
      provider_payload: { repositoryId: null },
      sync_payload: { eventType: "installation_repositories" },
    }));

    rpc.mockResolvedValueOnce({ data: [{ job_id: "bad" }], error: null });
    await expect(store.recordAndEnqueue(input)).rejects.toThrow("Webhook persistence failed");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "secret database detail" } });
    await expect(store.recordAndEnqueue(input)).rejects.toThrow("Webhook persistence failed");
  });
});
