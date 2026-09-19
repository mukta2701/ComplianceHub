// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { enqueueGitHubConnectionAlertDelivery } from "./slack-alert-store";

const INPUT = {
  organisationId: "33333333-3333-4333-8333-333333333333",
  channelId: "55555555-5555-4555-8555-555555555555",
  installationId: "22222222-2222-4222-8222-222222222222",
  kind: "incident" as const,
  diagnostic: "permission_mismatch" as const,
  payload: {
    type: "connection_health" as const,
    severity: "high" as const,
    title: "GitHub connection needs attention",
    controlRef: "GitHub connection",
    subjectId: "22222222-2222-4222-8222-222222222222",
    detail: "Access needs an Owner decision.",
  },
};

describe("enqueueGitHubConnectionAlertDelivery", () => {
  it("queues through the connection alert RPC and returns the validated lease", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ delivery_id: "66666666-6666-4666-8666-666666666666", lock_token: "77777777-7777-4777-8777-777777777777" }],
      error: null,
    });
    const lease = await enqueueGitHubConnectionAlertDelivery({ rpc } as never, INPUT);
    expect(rpc).toHaveBeenCalledWith(
      "enqueue_github_connection_alert_delivery",
      expect.objectContaining({
        target_organisation_id: INPUT.organisationId,
        target_channel_id: INPUT.channelId,
        target_installation_id: INPUT.installationId,
        target_kind: "incident",
        target_diagnostic_code: "permission_mismatch",
      }),
    );
    expect(lease).toEqual({ deliveryId: "66666666-6666-4666-8666-666666666666", lockToken: "77777777-7777-4777-8777-777777777777" });
  });

  it("returns null when an identical alert is already queued", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    await expect(enqueueGitHubConnectionAlertDelivery({ rpc } as never, INPUT)).resolves.toBeNull();
  });

  it("fails closed on database errors without surfacing internals", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "db-internal" } });
    await expect(enqueueGitHubConnectionAlertDelivery({ rpc } as never, INPUT)).rejects.toThrow(
      "Connection alert delivery queue failed",
    );
  });
});
