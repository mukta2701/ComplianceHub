import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  limit: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({ from: hoisted.from }),
}));

vi.mock("@/lib/observability/logger", () => ({
  logError: hoisted.logError,
}));

import { GET } from "./route";

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DAILY_DIGEST_RESERVATION_MODE", "bridge");
    vi.stubEnv("COMPLIANCEHUB_RELEASE_SHA", "0123456789abcdef0123456789abcdef01234567");
    hoisted.from.mockReturnValue({ select: hoisted.select });
    hoisted.select.mockReturnValue({ limit: hoisted.limit });
    hoisted.limit.mockResolvedValue({ data: [], error: null });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("checks connectivity through the existing service-readable error store", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      status: "ok",
      db: "ok",
      ms: expect.any(Number),
      slackDestinationPolicy: "v1",
      dailyDigestReservationMode: "bridge",
      releaseSha: "0123456789abcdef0123456789abcdef01234567",
    });
    expect(Object.keys(body)).toEqual([
      "status", "db", "ms", "slackDestinationPolicy", "dailyDigestReservationMode", "releaseSha",
    ]);
    expect(hoisted.from).toHaveBeenCalledWith("app_errors");
    expect(hoisted.select).toHaveBeenCalledWith("id");
    expect(hoisted.select).not.toHaveBeenCalledWith("id", expect.anything());
    expect(hoisted.limit).toHaveBeenCalledWith(1);
    expect(hoisted.logError).not.toHaveBeenCalled();
  });

  it("reports a degraded dependency and logs the database error", async () => {
    const databaseError = { code: "PGRST301", message: "database unavailable" };
    hoisted.limit.mockResolvedValue({ error: databaseError });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "degraded",
      db: "error",
      ms: expect.any(Number),
      slackDestinationPolicy: "v1",
      dailyDigestReservationMode: "bridge",
      releaseSha: "0123456789abcdef0123456789abcdef01234567",
    });
    expect(hoisted.logError).toHaveBeenCalledWith("route", "health check failed", databaseError);
  });

  it.each([undefined, "", "STRICT", "legacy", "bridge "])("defaults an absent or malformed reservation mode to strict: %s", async (mode) => {
    if (mode === undefined) vi.stubEnv("DAILY_DIGEST_RESERVATION_MODE", undefined);
    else vi.stubEnv("DAILY_DIGEST_RESERVATION_MODE", mode);

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({ dailyDigestReservationMode: "strict" });
  });

  it("never reflects arbitrary release or deployment configuration in health", async () => {
    vi.stubEnv("COMPLIANCEHUB_RELEASE_SHA", "private-ref-or-secret-value");
    vi.stubEnv("SLACK_ALLOWED_WEBHOOK_SHA256", "a".repeat(64));

    const response = await GET();
    const body = await response.json();

    expect(body.releaseSha).toBe("unknown");
    expect(JSON.stringify(body)).not.toContain("private-ref-or-secret-value");
    expect(JSON.stringify(body)).not.toContain("a".repeat(64));
    expect(body).not.toHaveProperty("configured");
    expect(body).not.toHaveProperty("slackAllowedWebhookSha256");
  });
});
