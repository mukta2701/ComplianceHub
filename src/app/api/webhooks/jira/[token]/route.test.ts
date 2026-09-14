import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashJiraWebhookToken } from "@/features/integrations/application/webhook-security";
import { createJiraWebhookHandler } from "./route";

const token = "A".repeat(43);
const webhookId = "71001";
const connection = {
  id: "20000000-0000-4000-8000-000000000001",
  organisationId: "20000000-0000-4000-8000-000000000002",
  provider: "jira" as const,
  jiraWebhookId: webhookId,
};
const target = { id: "20000000-0000-4000-8000-000000000003" };
const clientSecret = "jira-oauth-client-secret";

function jwt() {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iat: 1_784_073_590, exp: 1_784_073_720 })}`;
  return `${unsigned}.${createHmac("sha256", clientSecret).update(unsigned).digest("base64url")}`;
}

function request(body: string, headers: Record<string, string> = {}) {
  return new Request(`https://app.example/api/webhooks/jira/${token}`, {
    method: "POST",
    body,
    headers: {
      "x-atlassian-webhook-identifier": "8e4b7ce5-bd5f-46ee-838a-e49a2f87591b",
      authorization: `Bearer ${jwt()}`,
      ...headers,
    },
  });
}

function payload(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    timestamp: 1_784_070_400_000,
    webhookEvent: "jira:issue_updated",
    matchedWebhookIds: [Number(webhookId)],
    issue: {
      id: "10001",
      key: "SEC-1",
      fields: { project: { id: "10000", key: "SEC" } },
    },
    ...extra,
  });
}

function fixture() {
  const scheduleJob = vi.fn();
  const store = {
    findActiveJiraConnection: vi.fn(async () => connection),
    findActiveTarget: vi.fn(async () => target),
    recordAndEnqueue: vi.fn(async () => ({
      deliveryId: "20000000-0000-4000-8000-000000000004",
      jobId: "20000000-0000-4000-8000-000000000005",
      created: true,
    })),
  };
  return { store, handler: createJiraWebhookHandler({
    store,
    getClientSecret: () => clientSecret,
    nowSeconds: () => 1_784_073_600,
    scheduleJob,
  }), scheduleJob };
}

describe("POST /api/webhooks/jira/[token]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("binds only the hashed route token and configured project, then stores bounded metadata", async () => {
    const { store, scheduleJob, handler } = fixture();
    const response = await handler(request(payload({ cloudId: "attacker-tenant", organisationId: "attacker-org" })), {
      params: Promise.resolve({ token }),
    });

    expect(response.status).toBe(202);
    expect(store.findActiveJiraConnection).toHaveBeenCalledWith(hashJiraWebhookToken(token));
    expect(store.findActiveTarget).toHaveBeenCalledWith(connection, "10000");
    expect(store.recordAndEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      connection,
      targetId: target.id,
      deliveryKey: `${connection.id}:8e4b7ce5-bd5f-46ee-838a-e49a2f87591b`,
      eventType: "jira:issue_updated",
      kind: "provider_webhook",
      deliveryPayload: { issueId: "10001", projectId: "10000" },
      jobPayload: { eventType: "jira:issue_updated", issueId: "10001", projectId: "10000" },
    }));
    expect(JSON.stringify(store.recordAndEnqueue.mock.calls)).not.toContain("attacker-tenant");
    expect(JSON.stringify(store.recordAndEnqueue.mock.calls)).not.toContain("attacker-org");
    expect(JSON.stringify(store.recordAndEnqueue.mock.calls)).not.toContain(token);
    expect(store.recordAndEnqueue).toHaveBeenCalledOnce();
    expect(scheduleJob).toHaveBeenCalledOnce();
    expect(scheduleJob).toHaveBeenCalledWith("20000000-0000-4000-8000-000000000005");
  });

  it.each([
    ["missing bearer", ""],
    ["invalid bearer", "Bearer malformed"],
    ["wrong signature", `Bearer ${jwt().slice(0, -1)}x`],
  ])("rejects %s before resolving the callback token", async (_label, authorization) => {
    const { store, handler } = fixture();
    const response = await handler(request(payload(), { authorization }), { params: Promise.resolve({ token }) });
    expect(response.status).toBe(401);
    expect(store.findActiveJiraConnection).not.toHaveBeenCalled();
  });

  it("rejects a callback that does not name the resolver's current webhook", async () => {
    const { store, handler } = fixture();
    const response = await handler(request(payload({ matchedWebhookIds: [71099] })), {
      params: Promise.resolve({ token }),
    });
    expect(response.status).toBe(404);
    expect(store.recordAndEnqueue).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid token", "short", "8e4b7ce5-bd5f-46ee-838a-e49a2f87591b"],
    ["missing delivery identity", token, ""],
    ["invalid delivery identity", token, "bad header!"],
  ])("rejects %s before queue persistence", async (_label, routeToken, identifier) => {
    const { store, handler } = fixture();
    const response = await handler(request(payload(), { "x-atlassian-webhook-identifier": identifier }), {
      params: Promise.resolve({ token: routeToken }),
    });
    expect(response.status).toBe(routeToken === token ? 400 : 401);
    expect(store.recordAndEnqueue).not.toHaveBeenCalled();
  });

  it("rejects malformed, unsupported, and oversized bodies before persistence", async () => {
    const { store, handler } = fixture();
    expect((await handler(request("not-json"), { params: Promise.resolve({ token }) })).status).toBe(400);
    expect((await handler(request(payload({ webhookEvent: "jira:worklog_updated" })), { params: Promise.resolve({ token }) })).status).toBe(400);
    expect((await handler(request("x".repeat(262_145)), { params: Promise.resolve({ token }) })).status).toBe(413);
    expect(store.recordAndEnqueue).not.toHaveBeenCalled();
  });

  it("fails closed for disabled/revoked token binding or an unconfigured project", async () => {
    const { store, handler } = fixture();
    store.findActiveJiraConnection.mockResolvedValueOnce(null as never);
    expect((await handler(request(payload()), { params: Promise.resolve({ token }) })).status).toBe(404);
    store.findActiveJiraConnection.mockResolvedValueOnce(connection);
    store.findActiveTarget.mockResolvedValueOnce(null as never);
    expect((await handler(request(payload()), { params: Promise.resolve({ token }) })).status).toBe(404);
    expect(store.recordAndEnqueue).not.toHaveBeenCalled();
  });

  it("acknowledges exact retries without another queued job", async () => {
    const { store, handler } = fixture();
    store.recordAndEnqueue.mockResolvedValueOnce({
      deliveryId: "20000000-0000-4000-8000-000000000004",
      jobId: "20000000-0000-4000-8000-000000000005",
      created: false,
    });
    const response = await handler(request(payload()), { params: Promise.resolve({ token }) });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true, duplicate: true });
  });
});
