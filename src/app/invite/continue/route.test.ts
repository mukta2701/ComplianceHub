import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /invite/continue", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.com"));
  afterEach(() => vi.unstubAllEnvs());

  it("redirects to the token-free invitation page without changing cookies", async () => {
    const response = await GET();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.com/invite");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});
