import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ serverClient: null as unknown }));
const TEST_PASSWORD = Array.from({ length: 12 }, (_value, index) => String(index % 10)).join("");

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: () => Promise.resolve(hoisted.serverClient),
}));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`REDIRECT:${url}`), { digest: "NEXT_REDIRECT" });
  },
}));

import { signInAction, signInWithOAuthAction, signUpAction } from "./actions";

function authClient(options: {
  passwordError?: unknown;
  signupError?: unknown;
  oauthError?: unknown;
  oauthUrl?: string | null;
} = {}) {
  const signInWithPassword = vi.fn().mockResolvedValue({ error: options.passwordError ?? null });
  const signUp = vi.fn().mockResolvedValue({ error: options.signupError ?? null });
  const signInWithOAuth = vi.fn().mockResolvedValue({
    data: { url: options.oauthUrl === undefined ? "https://provider.example/authorize" : options.oauthUrl },
    error: options.oauthError ?? null,
  });
  return { value: { auth: { signInWithPassword, signUp, signInWithOAuth } }, signInWithPassword, signUp, signInWithOAuth };
}

function signInForm(next = "/app") {
  const form = new FormData();
  form.set("email", "member@example.test");
  form.set("password", TEST_PASSWORD);
  form.set("next", next);
  return form;
}

function signUpForm(next = "/app") {
  const form = new FormData();
  form.set("displayName", "Member");
  form.set("email", "member@example.test");
  form.set("password", TEST_PASSWORD);
  form.set("confirmPassword", TEST_PASSWORD);
  form.set("next", next);
  return form;
}

function oauthForm(provider: string, next = "/app") {
  const form = new FormData();
  form.set("provider", provider);
  form.set("next", next);
  return form;
}

describe("post-auth continuation", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.com");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["/invite", "/app", "/app/policies?state=draft"])("preserves safe password sign-in destination %s", async (next) => {
    const auth = authClient();
    hoisted.serverClient = auth.value;

    await expect(signInAction(signInForm(next))).rejects.toThrow(`REDIRECT:${next}`);

    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "member@example.test", password: TEST_PASSWORD });
  });

  it.each(["https://evil.example/steal", "//evil.example/steal", "/\\evil.example/steal", "/%5Cevil.example/steal", "/invite/raw-token", "/sign-in"])(
    "falls back to /app for unsafe password continuation %s",
    async (next) => {
      const auth = authClient();
      hoisted.serverClient = auth.value;

      await expect(signInAction(signInForm(next))).rejects.toThrow("REDIRECT:/app");
    },
  );

  it("preserves only a safe next value across password validation and auth failures", async () => {
    const auth = authClient({ passwordError: { message: "sensitive" } });
    hoisted.serverClient = auth.value;

    await expect(signInAction(signInForm("/invite"))).rejects.toThrow(/REDIRECT:\/sign-in\?.*next=%2Finvite/);

    const invalid = signInForm("https://evil.example");
    invalid.set("email", "not-an-email");
    await expect(signInAction(invalid)).rejects.toThrow(/^REDIRECT:\/sign-in\?message=/);
    await expect(signInAction(invalid)).rejects.not.toThrow(/evil/);
  });

  it("uses the canonical callback and safe invitation continuation for sign-up confirmation", async () => {
    const auth = authClient();
    hoisted.serverClient = auth.value;

    await expect(signUpAction(signUpForm("/invite"))).rejects.toThrow(/REDIRECT:\/sign-in\?.*next=%2Finvite/);

    expect(auth.signUp).toHaveBeenCalledWith(expect.objectContaining({
      email: "member@example.test",
      options: expect.objectContaining({
        emailRedirectTo: "https://app.example.com/auth/callback?next=%2Finvite",
      }),
    }));
  });

  it("never includes an unsafe sign-up continuation in the confirmation callback", async () => {
    const auth = authClient();
    hoisted.serverClient = auth.value;

    await expect(signUpAction(signUpForm("//evil.example"))).rejects.toThrow(/REDIRECT:\/sign-in\?/);

    expect(auth.signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        emailRedirectTo: "https://app.example.com/auth/callback?next=%2Fapp",
      }),
    }));
  });
});

describe("gated Supabase social sign-in", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.com");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["google", "GOOGLE_AUTH_ENABLED"],
    ["azure", "MICROSOFT_AUTH_ENABLED"],
  ])("does not call disabled %s provider", async (provider) => {
    const auth = authClient();
    hoisted.serverClient = auth.value;

    await expect(signInWithOAuthAction(oauthForm(provider, "/invite"))).rejects.toThrow(/REDIRECT:\/sign-in\?.*next=%2Finvite/);

    expect(auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("rejects an unrecognised provider without calling Supabase", async () => {
    vi.stubEnv("GOOGLE_AUTH_ENABLED", "1");
    const auth = authClient();
    hoisted.serverClient = auth.value;

    await expect(signInWithOAuthAction(oauthForm("github", "/invite"))).rejects.toThrow(/REDIRECT:\/sign-in\?/);

    expect(auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("starts Google OAuth with the canonical allowlisted callback", async () => {
    vi.stubEnv("GOOGLE_AUTH_ENABLED", "1");
    const auth = authClient();
    hoisted.serverClient = auth.value;

    await expect(signInWithOAuthAction(oauthForm("google", "/invite"))).rejects.toThrow("REDIRECT:https://provider.example/authorize");

    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "https://app.example.com/auth/callback?next=%2Finvite" },
    });
  });

  it("requests the required email scope for Microsoft Azure", async () => {
    vi.stubEnv("MICROSOFT_AUTH_ENABLED", "1");
    const auth = authClient();
    hoisted.serverClient = auth.value;

    await expect(signInWithOAuthAction(oauthForm("azure", "/invite"))).rejects.toThrow("REDIRECT:https://provider.example/authorize");

    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "azure",
      options: { redirectTo: "https://app.example.com/auth/callback?next=%2Finvite", scopes: "email" },
    });
  });

  it.each([
    ["provider error", { oauthError: { message: "sensitive" } }],
    ["missing provider URL", { oauthUrl: null }],
  ])("returns a generic token-free error for %s", async (_label, options) => {
    vi.stubEnv("GOOGLE_AUTH_ENABLED", "1");
    const auth = authClient(options);
    hoisted.serverClient = auth.value;

    await expect(signInWithOAuthAction(oauthForm("google", "/invite"))).rejects.toThrow(/REDIRECT:\/sign-in\?.*next=%2Finvite/);
  });
});
