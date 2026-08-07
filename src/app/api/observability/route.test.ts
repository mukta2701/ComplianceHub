import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  enforceRateLimit: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("@/lib/observability/logger", () => ({ logError: hoisted.logError }));

import { POST } from "./route";

function streamingRequest(chunks: Uint8Array[], headers: HeadersInit = {}) {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
  });
  return new Request("https://compliance.example/api/observability", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("POST /api/observability", () => {
  beforeEach(() => {
    hoisted.enforceRateLimit.mockReset().mockResolvedValue(undefined);
    hoisted.logError.mockReset().mockResolvedValue(undefined);
  });

  it("never persists a credential-bearing browser URL", async () => {
    const secret = ["synthetic", "auditor", "bearer", "value"].join("-");
    const request = new Request("https://compliance.example/api/observability", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
      body: JSON.stringify({
        message: `Failed loading https://compliance.example/audit-view/${secret}`,
        digest: "safe-digest",
        url: `https://compliance.example/audit-view/${secret}?return=${secret}`,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(hoisted.logError).toHaveBeenCalledWith(
      "client",
      "client error",
      undefined,
      { digestHash: createHash("sha256").update("safe-digest", "utf8").digest("hex") },
    );
    expect(JSON.stringify(hoisted.logError.mock.calls)).not.toContain(secret);
  });

  it("rejects non-JSON media types before parsing or logging", async () => {
    const response = await POST(new Request("https://compliance.example/api/observability", {
      method: "POST",
      headers: { "content-type": "application/json-patch+json" },
      body: JSON.stringify({ digest: "safe-digest" }),
    }));

    expect(response.status).toBe(415);
    expect(hoisted.logError).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared body without reading its stream", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new TextEncoder().encode('{"digest":"safe-digest"}'));
        controller.close();
      },
    }, { highWaterMark: 0 });
    const request = new Request("https://compliance.example/api/observability", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "8193" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const pullsBeforeHandler = pulls;

    const response = await POST(request);

    expect(response.status).toBe(413);
    // A zero high-water mark disables ReadableStream's own eager pull, so any
    // subsequent pull would prove the route read before enforcing the header.
    expect(pulls).toBe(pullsBeforeHandler);
    expect(hoisted.logError).not.toHaveBeenCalled();
  });

  it("rejects an oversized streamed body even without Content-Length", async () => {
    const response = await POST(streamingRequest([
      new Uint8Array(4_096),
      new Uint8Array(4_097),
    ]));

    expect(response.status).toBe(413);
    expect(hoisted.logError).not.toHaveBeenCalled();
  });

  it("still returns 413 when cancelling an oversized stream rejects", async () => {
    let cancelAttempted = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8_193));
      },
      cancel() {
        cancelAttempted = true;
        return Promise.reject(new Error("synthetic cancel failure"));
      },
    });
    const request = new Request("https://compliance.example/api/observability", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await POST(request);

    expect(cancelAttempted).toBe(true);
    expect(response.status).toBe(413);
    expect(hoisted.logError).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid UTF-8", [new Uint8Array([0xc3, 0x28])]],
    ["invalid JSON", [new TextEncoder().encode("{not-json")]],
  ])("rejects %s without logging", async (_label, chunks) => {
    const response = await POST(streamingRequest(chunks));

    expect(response.status).toBe(400);
    expect(hoisted.logError).not.toHaveBeenCalled();
  });

  it.each([
    { digest: "" },
    { digest: "x".repeat(201) },
    { digest: "contains spaces" },
    { digest: 123 },
    {},
  ])("rejects an invalid opaque digest %#", async (body) => {
    const response = await POST(new Request("https://compliance.example/api/observability", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    }));

    expect(response.status).toBe(400);
    expect(hoisted.logError).not.toHaveBeenCalled();
  });

  it("accepts a short opaque digest from a bounded JSON body", async () => {
    const response = await POST(new Request("https://compliance.example/api/observability", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ digest: "NEXT_ERROR.4f91a2c0-7" }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(hoisted.logError).toHaveBeenCalledWith(
      "client",
      "client error",
      undefined,
      { digestHash: createHash("sha256").update("NEXT_ERROR.4f91a2c0-7", "utf8").digest("hex") },
    );
  });

  it("one-way hashes a credential-shaped digest before logging", async () => {
    const credentialShapedDigest = "eyJhbGciOiJIUzI1NiJ9.synthetic_API-key.signature123";
    const response = await POST(new Request("https://compliance.example/api/observability", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ digest: credentialShapedDigest }),
    }));

    expect(response.status).toBe(200);
    expect(hoisted.logError).toHaveBeenCalledWith(
      "client",
      "client error",
      undefined,
      { digestHash: createHash("sha256").update(credentialShapedDigest, "utf8").digest("hex") },
    );
    expect(JSON.stringify(hoisted.logError.mock.calls)).not.toContain(credentialShapedDigest);
  });
});
