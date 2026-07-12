import { describe, expect, it, vi } from "vitest";
import { MemoryRateLimitStore, enforceRateLimit, type RateLimitStore } from "./rate-limit";

vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn().mockResolvedValue(undefined) }));

describe("rate limiting", () => {
  it("blocks attempts after the configured limit within a window", async () => {
    const store = new MemoryRateLimitStore();
    await enforceRateLimit("sign-in:1", { limit: 2, windowMs: 60_000, store, now: () => 100 });
    await enforceRateLimit("sign-in:1", { limit: 2, windowMs: 60_000, store, now: () => 100 });
    await expect(enforceRateLimit("sign-in:1", { limit: 2, windowMs: 60_000, store, now: () => 100 })).rejects.toThrow("Too many requests");
  });

  it("falls back to the in-memory counter (still enforcing) when the durable store throws", async () => {
    // A store that is always unavailable — the app must not be taken down, but the
    // limit must still hold via the fallback within the same process.
    const brokenStore: RateLimitStore = { increment: async () => { throw new Error("db down"); } };
    const opts = { limit: 2, windowMs: 60_000, store: brokenStore, now: () => 500 };
    await enforceRateLimit("action:x", opts);
    await enforceRateLimit("action:x", opts);
    await expect(enforceRateLimit("action:x", opts)).rejects.toThrow("Too many requests");
  });
});
