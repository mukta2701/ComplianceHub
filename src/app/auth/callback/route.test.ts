import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ exchangeCodeForSession: vi.fn() }));

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

  it("uses the canonical origin for callback failures too", async () => {
    hoisted.exchangeCodeForSession.mockResolvedValueOnce({ error: { message: "sensitive" } });

    const response = await GET(callbackRequest("/invite"));

    expect(response.headers.get("location")).toBe(
      "https://compliancehub.example/sign-in?message=The%20confirmation%20link%20is%20invalid%20or%20expired.",
    );
  });
});
