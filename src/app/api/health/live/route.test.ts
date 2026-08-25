import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

describe("GET /api/health/live", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports process liveness without depending on external services", async () => {
    vi.stubEnv("DAILY_DIGEST_RESERVATION_MODE", "strict");
    vi.stubEnv("COMPLIANCEHUB_RELEASE_SHA", "fedcba9876543210fedcba9876543210fedcba98");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      slackDestinationPolicy: "v1",
      dailyDigestReservationMode: "strict",
      releaseSha: "fedcba9876543210fedcba9876543210fedcba98",
    });
  });
});
