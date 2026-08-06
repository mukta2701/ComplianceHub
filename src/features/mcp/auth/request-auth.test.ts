// @vitest-environment node
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { parseBearerToken, verifyMcpJwt, authenticateMcpRequest } from "./request-auth";
import { parseMcpOAuthEnvironment } from "./oauth-config";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
let privateKey: CryptoKey;
let keySet: ReturnType<typeof createLocalJWKSet>;
const config = parseMcpOAuthEnvironment({
  NODE_ENV: "production", MCP_RESOURCE_URL: "https://compliance.example/mcp",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_OAUTH_ISSUER: "https://project.supabase.co/auth/v1",
  SUPABASE_OAUTH_JWKS_URL: "https://project.supabase.co/auth/v1/.well-known/jwks.json",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "publishable-key-with-sufficient-length", MCP_JWT_ALGORITHMS: "RS256",
});

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  const publicJwk = await exportJWK(pair.publicKey);
  keySet = createLocalJWKSet({ keys: [{ ...publicJwk, kid: "test", alg: "RS256" }] });
});

async function token(overrides: Record<string, unknown> = {}, protectedOverrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: "authenticated", session_id: sessionId, client_id: "codex-client", ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "test", ...protectedOverrides })
    .setSubject(String(overrides.sub ?? userId)).setIssuer(String(overrides.iss ?? config.authorizationServer))
    .setAudience(String(overrides.aud ?? config.resource)).setIssuedAt(now).setExpirationTime(Number(overrides.exp ?? now + 300))
    .sign(privateKey);
}

describe("parseBearerToken", () => {
  it("accepts exactly one bearer credential", () => expect(parseBearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi"));
  it.each([null, "", "Basic abc", "Bearer", "Bearer one two", "Bearer a, Bearer b"])("rejects %s", (value) => {
    expect(() => parseBearerToken(value)).toThrow();
  });
});

describe("verifyMcpJwt", () => {
  it("verifies the signature and all required resource-server claims", async () => {
    await expect(verifyMcpJwt(await token(), config, keySet)).resolves.toEqual(expect.objectContaining({ sub: userId, client_id: "codex-client" }));
  });

  it.each([
    ["issuer", { iss: "https://attacker.example/auth/v1" }], ["audience", { aud: "https://other.example/mcp" }],
    ["expiry", { exp: 1 }], ["subject", { sub: "not-a-uuid" }], ["client", { client_id: "" }],
    ["role", { role: "service_role" }], ["session", { session_id: "bad" }],
  ])("rejects an invalid %s", async (_label, overrides) => {
    await expect(verifyMcpJwt(await token(overrides), config, keySet)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("rejects a not-yet-valid token", async () => {
    const value = await token({ nbf: Math.floor(Date.now() / 1000) + 300 });
    await expect(verifyMcpJwt(value, config, keySet)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("rejects a token signed by another key", async () => {
    const other = await generateKeyPair("RS256");
    const now = Math.floor(Date.now() / 1000);
    const value = await new SignJWT({ role: "authenticated", session_id: sessionId, client_id: "codex-client" })
      .setProtectedHeader({ alg: "RS256", kid: "test" }).setSubject(userId).setIssuer(config.authorizationServer)
      .setAudience(config.resource).setIssuedAt(now).setExpirationTime(now + 300).sign(other.privateKey);
    await expect(verifyMcpJwt(value, config, keySet)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("rejects an algorithm outside the configured asymmetric allowlist", async () => {
    const pair = await generateKeyPair("ES256");
    const now = Math.floor(Date.now() / 1000);
    const value = await new SignJWT({ role: "authenticated", session_id: sessionId, client_id: "codex-client" })
      .setProtectedHeader({ alg: "ES256" }).setSubject(userId).setIssuer(config.authorizationServer)
      .setAudience(config.resource).setIssuedAt(now).setExpirationTime(now + 300).sign(pair.privateKey);
    await expect(verifyMcpJwt(value, config, async () => pair.publicKey)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });
});

describe("authenticateMcpRequest", () => {
  it("rechecks the token with Supabase and returns only a user-scoped client", async () => {
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null });
    const client = { auth: { getUser } };
    const result = await authenticateMcpRequest(new Request(config.resource, { headers: { authorization: `Bearer ${await token()}` } }), {
      config, keySet, createUserClient: vi.fn(() => client as never),
    });
    expect(getUser).toHaveBeenCalledWith(expect.any(String));
    expect(result.user.id).toBe(userId);
    expect(result.supabase).toBe(client);
  });

  it("rejects revoked sessions and a Supabase user mismatch", async () => {
    for (const response of [
      { data: { user: null }, error: { message: "revoked" } },
      { data: { user: { id: "33333333-3333-4333-8333-333333333333" } }, error: null },
    ]) {
      await expect(authenticateMcpRequest(new Request(config.resource, { headers: { authorization: `Bearer ${await token()}` } }), {
        config, keySet, createUserClient: () => ({ auth: { getUser: vi.fn().mockResolvedValue(response) } }) as never,
      })).rejects.toMatchObject({ code: "INVALID_TOKEN" });
    }
  });
});
