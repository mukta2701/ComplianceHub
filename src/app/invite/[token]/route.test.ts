import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as route from "./route";

const VALID_TOKEN = "A".repeat(43);

async function invoke(token: string) {
  return route.GET(
    new Request(`https://untrusted-host.example/invite/${encodeURIComponent(token)}`),
    { params: Promise.resolve({ token }) },
  );
}

describe("GET /invite/[token]", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.com");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("exports a public GET route handler", () => {
    expect((route as { GET?: unknown }).GET).toBeTypeOf("function");
  });

  it("exchanges an exact token for a short-lived HttpOnly cookie and a canonical token-free redirect", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await invoke(VALID_TOKEN);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.com/invite");
    expect(response.headers.get("set-cookie")).toMatch(
      new RegExp(`^compliancehub_invitation_token=${VALID_TOKEN}; Path=/invite; Expires=[^;]+; Max-Age=2700; Secure; HttpOnly; SameSite=lax$`),
    );
  });

  it.each([
    ["too short", "A".repeat(42)],
    ["too long", "A".repeat(44)],
    ["non-base64url", `${"A".repeat(42)}=`],
    ["encoded control", `${"A".repeat(42)}\n`],
  ])("does not set a secret cookie for a %s token", async (_label, token) => {
    const response = await invoke(token);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.com/invite?status=unavailable");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("applies no-store, no-referrer, and no-index headers to both outcomes", async () => {
    for (const token of [VALID_TOKEN, "invalid"]) {
      const response = await invoke(token);

      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    }
  });

  it("never echoes the raw bearer token in the redirect or response body", async () => {
    const response = await invoke(VALID_TOKEN);
    const body = await response.text();

    expect(response.headers.get("location")).not.toContain(VALID_TOKEN);
    expect(body).not.toContain(VALID_TOKEN);
  });
});
