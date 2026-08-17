import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ service: { from: vi.fn() }, createClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: hoisted.createClient }));
const testSecret = randomUUID();

function signedRequest(event: string, body: string, options: { delivery?: string; signature?: string; contentLength?: string } = {}) {
  const signature = options.signature ?? `sha256=${createHmac("sha256", testSecret).update(body).digest("hex")}`;
  const headers = new Headers({
    "content-type": "application/json",
    "x-github-event": event,
    "x-github-delivery": options.delivery ?? randomUUID(),
    "x-hub-signature-256": signature,
  });
  if (options.contentLength) headers.set("content-length", options.contentLength);
  return new Request("http://localhost/api/github/webhook", { method: "POST", headers, body });
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("GITHUB_WEBHOOK_SECRET", testSecret);
  hoisted.createClient.mockReset().mockReturnValue(hoisted.service);
  hoisted.service.from.mockReset().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) });
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/github/webhook", () => {
  it.each([undefined, "sha256=bad"])("rejects a missing or invalid signature", async (signature) => {
    const request = signedRequest("repository", JSON.stringify({ installation: { id: 71 }, repository: { id: 91 } }), { signature });
    if (signature === undefined) request.headers.delete("x-hub-signature-256");
    const { POST } = await import("./route");
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(hoisted.createClient).not.toHaveBeenCalled();
  });

  it("fails closed when the webhook secret is absent", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "");
    const { POST } = await import("./route");
    const response = await POST(signedRequest("repository", "{}"));
    expect(response.status).toBe(503);
    expect(hoisted.createClient).not.toHaveBeenCalled();
  });

  it("returns 413 before persistence for an oversized body", async () => {
    const { POST } = await import("./route");
    const response = await POST(signedRequest("repository", "{}", { contentLength: "1048577" }));
    expect(response.status).toBe(413);
    expect(hoisted.createClient).not.toHaveBeenCalled();
  });

  it("accepts an exact one-MiB signed JSON body", async () => {
    const prefix = '{"installation":{"id":71},"repository":{"id":91},"padding":"';
    const suffix = '"}';
    const body = `${prefix}${"a".repeat(1024 * 1024 - prefix.length - suffix.length)}${suffix}`;
    expect(new TextEncoder().encode(body)).toHaveLength(1024 * 1024);
    const { POST } = await import("./route");
    const response = await POST(signedRequest("repository", body, { contentLength: "1048576", delivery: "delivery:exact-limit" }));
    expect(response.status).toBe(202);
  });

  it("rejects malformed or understated Content-Length without trusting it as the stream bound", async () => {
    const { POST } = await import("./route");
    expect((await POST(signedRequest("repository", "{}", { contentLength: "1e2" }))).status).toBe(400);
    const oversized = "x".repeat(1024 * 1024 + 1);
    expect((await POST(signedRequest("repository", oversized, { contentLength: "1" }))).status).toBe(413);
    expect(hoisted.createClient).not.toHaveBeenCalled();
  });

  it("checks the signature before untrusted delivery headers or JSON routing", async () => {
    const { POST } = await import("./route");
    const response = await POST(signedRequest("repository", "{", { delivery: "has space", signature: "sha256=bad" }));
    expect(response.status).toBe(401);
    expect(hoisted.createClient).not.toHaveBeenCalled();
  });

  it("persists an unsupported signed event as terminal ignored without parsing routing", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    hoisted.service.from.mockReturnValue({ insert });
    const { POST } = await import("./route");
    const response = await POST(signedRequest("push", "not json and provider token text"));
    expect(response.status).toBe(202);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      event_name: "push",
      status: "ignored",
      processed_at: expect.any(String),
    }));
    const stored = insert.mock.calls[0][0];
    expect(stored).not.toHaveProperty("provider_installation_id");
    expect(stored).not.toHaveProperty("provider_repository_id");
    expect(JSON.stringify(stored)).not.toContain("token text");
  });

  it("queues a supported event using only provider routing IDs and a body hash", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    hoisted.service.from.mockReturnValue({ insert });
    const body = JSON.stringify({ installation: { id: 71 }, repository: { id: 91 }, sender: { login: "ignore" } });
    const delivery = "delivery:retry/v2!";
    const { POST } = await import("./route");
    const response = await POST(signedRequest("repository", body, { delivery }));
    expect(response.status).toBe(202);
    expect(insert).toHaveBeenCalledWith({
      provider_delivery_id: delivery,
      event_name: "repository",
      payload_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      provider_installation_id: 71,
      provider_repository_id: 91,
    });
    expect(JSON.stringify(insert.mock.calls)).not.toContain("ignore");
  });

  it("rejects whitespace and control characters in a delivery ID", async () => {
    const { POST } = await import("./route");
    const body = JSON.stringify({ installation: { id: 71 }, repository: { id: 91 } });
    expect((await POST(signedRequest("repository", body, { delivery: "has space" }))).status).toBe(400);
    expect((await POST(signedRequest("repository", body, { delivery: "has\ttab" }))).status).toBe(400);
    expect(hoisted.createClient).not.toHaveBeenCalled();
  });

  it("returns 400 for signed malformed JSON or invalid routing IDs", async () => {
    const { POST } = await import("./route");
    const malformed = await POST(signedRequest("repository", "{"));
    const unsafe = await POST(signedRequest("repository", JSON.stringify({ installation: { id: 71 }, repository: { id: "91" } })));
    expect(malformed.status).toBe(400);
    expect(unsafe.status).toBe(400);
    expect(hoisted.createClient).not.toHaveBeenCalled();
  });

  it("treats only database 23505 as an accepted duplicate", async () => {
    const insert = vi.fn().mockResolvedValueOnce({ error: { code: "23505", message: "duplicate with private body" } }).mockResolvedValueOnce({ error: { code: "42501", message: "database private body" } });
    hoisted.service.from.mockReturnValue({ insert });
    const { POST } = await import("./route");
    const body = JSON.stringify({ installation: { id: 71 }, repository: { id: 91 } });
    expect((await POST(signedRequest("repository", body))).status).toBe(202);
    expect((await POST(signedRequest("repository", body))).status).toBe(503);
  });

  it("accepts concurrent insert-only replays of the same provider delivery", async () => {
    const insert = vi.fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { code: "23505", message: "unique replay" } });
    hoisted.service.from.mockReturnValue({ insert });
    const { POST } = await import("./route");
    const body = JSON.stringify({ installation: { id: 71 }, repository: { id: 91 } });
    const delivery = "delivery:concurrent/retry";
    const [first, second] = await Promise.all([
      POST(signedRequest("repository", body, { delivery })),
      POST(signedRequest("repository", body, { delivery })),
    ]);
    expect([first.status, second.status]).toEqual([202, 202]);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(hoisted.service.from).toHaveBeenCalledTimes(2);
  });
});
