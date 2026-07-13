import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ exchangeCodeForSession: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => Promise.resolve({
    auth: { exchangeCodeForSession: hoisted.exchangeCodeForSession },
  }),
}));

import { GET } from "./route";

function callbackRequest(next: string): Request {
  const url = new URL("https://compliancehub.example/auth/callback");
  url.searchParams.set("code", "valid-code");
  url.searchParams.set("next", next);
  return new Request(url);
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    hoisted.exchangeCodeForSession.mockReset();
    hoisted.exchangeCodeForSession.mockResolvedValue({ error: null });
  });

  it.each([
    "/app",
    "/app/policies?status=approved",
    "/invite/invitation-token",
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
  ])("falls back to /app for a %s", async (_label, next) => {
    const response = await GET(callbackRequest(next));

    expect(response.headers.get("location")).toBe("https://compliancehub.example/app");
  });
});
