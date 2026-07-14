import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ exchangeCodeForSession: vi.fn() }));
const RAW_INVITATION_VALUE = "A".repeat(43);

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => Promise.resolve({
    auth: { exchangeCodeForSession: hoisted.exchangeCodeForSession },
  }),
}));

import { GET } from "./route";

function callbackRequest(next: string): Request {
  const url = new URL("https://untrusted-host.example/auth/callback");
  url.searchParams.set("code", "valid-code");
  url.searchParams.set("next", next);
  return new Request(url);
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://compliancehub.example");
    hoisted.exchangeCodeForSession.mockReset();
    hoisted.exchangeCodeForSession.mockResolvedValue({ error: null });
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([
    "/app",
    "/app/policies?status=approved",
    "/invite",
    "/reset-password",
  ])("preserves the allowed internal destination %s", async (next) => {
    const response = await GET(callbackRequest(next));

    expect(response.headers.get("location")).toBe(`https://compliancehub.example${next}`);
  });

  it.each([
    ["absolute foreign URL", "https://evil.example/steal"],
    ["protocol-relative URL", "//evil.example/steal"],
    ["backslash authority bypass", "/\\evil.example/steal"],
    ["encoded backslash authority bypass", "/%5Cevil.example/steal"],
    ["control character", "/app\n/evil"],
    ["unapproved internal path", "/sign-in"],
    ["raw invitation path", "/invite/invitation-token"],
  ])("falls back to /app for a %s", async (_label, next) => {
    const response = await GET(callbackRequest(next));

    expect(response.headers.get("location")).toBe("https://compliancehub.example/app");
  });

  it("retains a canonical token-free invite continuation for callback failures", async () => {
    hoisted.exchangeCodeForSession.mockResolvedValueOnce({ error: { message: "sensitive" } });

    const response = await GET(callbackRequest(`/invite?token=${RAW_INVITATION_VALUE}`));
    const location = new URL(String(response.headers.get("location")));

    expect(location.origin).toBe("https://compliancehub.example");
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("message")).toBe("The confirmation link is invalid or expired.");
    expect(location.searchParams.get("next")).toBe("/invite");
    expect(location.href).not.toContain(RAW_INVITATION_VALUE);
  });

  it("does not retry a failed password-recovery callback at /reset-password without a recovery session", async () => {
    hoisted.exchangeCodeForSession.mockResolvedValueOnce({ error: { message: "sensitive" } });

    const response = await GET(callbackRequest("/reset-password"));
    const location = new URL(String(response.headers.get("location")));

    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe("/app");
  });

  it("sanitizes an attack destination on callback failure without echoing its raw value", async () => {
    hoisted.exchangeCodeForSession.mockResolvedValueOnce({ error: { message: "sensitive" } });

    const response = await GET(callbackRequest(`//evil.example/${RAW_INVITATION_VALUE}`));
    const location = new URL(String(response.headers.get("location")));

    expect(location.origin).toBe("https://compliancehub.example");
    expect(location.searchParams.get("next")).toBe("/app");
    expect(location.href).not.toContain(RAW_INVITATION_VALUE);
  });

  it("canonicalizes invite query/hash data out of a successful callback", async () => {
    const response = await GET(callbackRequest(`/invite?token=${RAW_INVITATION_VALUE}#${RAW_INVITATION_VALUE}`));

    expect(response.headers.get("location")).toBe("https://compliancehub.example/invite");
    expect(response.headers.get("location")).not.toContain(RAW_INVITATION_VALUE);
  });
});
