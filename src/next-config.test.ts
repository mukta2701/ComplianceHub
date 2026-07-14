import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig, { buildConnectSrc } from "../next.config";

describe("buildConnectSrc", () => {
  it("allows the configured local Supabase HTTP and WebSocket origins in development", () => {
    expect(buildConnectSrc("development", "http://127.0.0.1:54321")).toBe(
      "'self' https://*.supabase.co wss://*.supabase.co http://127.0.0.1:54321 ws://127.0.0.1:54321",
    );
  });

  it("does not weaken the production policy", () => {
    expect(buildConnectSrc("production", "http://127.0.0.1:54321")).toBe(
      "'self' https://*.supabase.co wss://*.supabase.co",
    );
  });

  it("does not add arbitrary remote origins in development", () => {
    expect(buildConnectSrc("development", "http://example.test:54321")).toBe(
      "'self' https://*.supabase.co wss://*.supabase.co",
    );
  });
});

describe("public invitation transport", () => {
  it("ships a public raw-token exchange route and a server-only cookie helper", () => {
    expect(existsSync(join(process.cwd(), "src/app/invite/[token]/route.ts"))).toBe(true);
    expect(existsSync(join(process.cwd(), "src/lib/invitation-cookie.ts"))).toBe(true);
    expect(existsSync(join(process.cwd(), "src/app/invite/page.tsx"))).toBe(true);
    expect(existsSync(join(process.cwd(), "src/app/invite/actions.ts"))).toBe(true);
  });

  it("removes the protected raw-query invitation acceptance page", () => {
    expect(existsSync(join(process.cwd(), "src/app/app/invitations/accept/page.tsx"))).toBe(false);
  });

  it("overrides only invitation responses with no-store, no-referrer, and no-index headers", async () => {
    const rules = await nextConfig.headers?.();
    const invitationRule = rules?.find((rule) => rule.source === "/invite/:path*");

    expect(invitationRule?.headers).toEqual(expect.arrayContaining([
      { key: "Cache-Control", value: "no-store" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ]));
    expect(invitationRule?.headers.some((header) => header.key === "Content-Security-Policy")).toBe(false);
  });
});
