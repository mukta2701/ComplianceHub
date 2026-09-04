import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  generateJiraWebhookToken,
  hashJiraWebhookToken,
  readBoundedWebhookBody,
  sha256Hex,
  verifyGitHubWebhookSignature,
  verifyJiraWebhookJwt,
} from "./webhook-security";

function jiraJwt(payload: Record<string, unknown>, secret: string, header: Record<string, unknown> = { alg: "HS256", typ: "JWT" }) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode(header)}.${encode(payload)}`;
  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

describe("native webhook security", () => {
  it("verifies only an exact GitHub sha256 signature", () => {
    const body = new TextEncoder().encode('{"installation":{"id":42}}');
    const secret = "test-webhook-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

    expect(verifyGitHubWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyGitHubWebhookSignature(body, `sha256=${"0".repeat(64)}`, secret)).toBe(false);
    expect(verifyGitHubWebhookSignature(body, signature.toUpperCase(), secret)).toBe(false);
    expect(verifyGitHubWebhookSignature(body, null, secret)).toBe(false);
  });

  it("bounds a streamed body before JSON decoding even when content-length lies", async () => {
    const request = new Request("https://example.test/webhook", {
      method: "POST",
      body: "x".repeat(17),
      headers: { "content-length": "2" },
    });

    await expect(readBoundedWebhookBody(request, 16)).rejects.toMatchObject({
      code: "body_too_large",
    });
  });

  it("rejects an oversized declared body without reading it", async () => {
    const request = new Request("https://example.test/webhook", {
      method: "POST",
      body: "{}",
      headers: { "content-length": "17" },
    });
    await expect(readBoundedWebhookBody(request, 16)).rejects.toMatchObject({
      code: "body_too_large",
    });
  });

  it("generates an unguessable Jira callback token and persists only its hash", () => {
    const token = generateJiraWebhookToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashJiraWebhookToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashJiraWebhookToken(token)).not.toContain(token);
    expect(() => hashJiraWebhookToken("short")).toThrow("Jira webhook token is invalid");
  });

  it("hashes the exact raw bytes for replay comparison", () => {
    expect(sha256Hex(new TextEncoder().encode("payload"))).toBe(
      "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5",
    );
  });

  it("verifies only a fresh HS256 Jira bearer JWT using the app client secret", () => {
    const now = 1_784_073_600;
    const secret = "jira-oauth-client-secret";
    const token = jiraJwt({ iat: now - 10, exp: now + 120 }, secret);
    expect(verifyJiraWebhookJwt(token, secret, now)).toBe(true);
    expect(verifyJiraWebhookJwt(token, "wrong-secret", now)).toBe(false);
    expect(verifyJiraWebhookJwt(jiraJwt({ iat: now - 500, exp: now - 301 }, secret), secret, now)).toBe(false);
    expect(verifyJiraWebhookJwt(jiraJwt({ iat: now + 31, exp: now + 120 }, secret), secret, now)).toBe(false);
    expect(verifyJiraWebhookJwt(jiraJwt({ exp: now + 120 }, secret), secret, now)).toBe(false);
    expect(verifyJiraWebhookJwt(jiraJwt({ iat: now - 10 }, secret), secret, now)).toBe(false);
    expect(verifyJiraWebhookJwt(jiraJwt({ iat: now - 10, exp: now + 3_600 }, secret), secret, now)).toBe(false);
    expect(verifyJiraWebhookJwt({ toString: () => token } as unknown as string, secret, now)).toBe(false);
    expect(verifyJiraWebhookJwt(jiraJwt({ iat: now - 10, exp: now + 120 }, secret, { alg: "none" }), secret, now)).toBe(false);
  });
});
