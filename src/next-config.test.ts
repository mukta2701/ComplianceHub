import { describe, expect, it } from "vitest";
import { buildConnectSrc } from "../next.config";

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
