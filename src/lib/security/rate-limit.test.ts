import { describe, expect, it } from "vitest";
import { MemoryRateLimitStore, enforceRateLimit } from "./rate-limit";

describe("rate limiting", () => {
  it("blocks attempts after the configured limit within a window", async () => {
    const store = new MemoryRateLimitStore();
    await enforceRateLimit("sign-in:1", { limit: 2, windowMs: 60_000, store, now: () => 100 });
    await enforceRateLimit("sign-in:1", { limit: 2, windowMs: 60_000, store, now: () => 100 });
    await expect(enforceRateLimit("sign-in:1", { limit: 2, windowMs: 60_000, store, now: () => 100 })).rejects.toThrow("Too many requests");
  });
});
