import { beforeEach, describe, expect, it, vi } from "vitest";

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
    hoisted.from.mockReturnValue({ select: hoisted.select });
    hoisted.select.mockReturnValue({ limit: hoisted.limit });
    hoisted.limit.mockResolvedValue({ error: null });
  });

  it("checks connectivity through the existing service-readable error store", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok", db: "ok" });
    expect(hoisted.from).toHaveBeenCalledWith("app_errors");
    expect(hoisted.select).toHaveBeenCalledWith("id", { head: true, count: "exact" });
    expect(hoisted.limit).toHaveBeenCalledWith(1);
    expect(hoisted.logError).not.toHaveBeenCalled();
  });

  it("reports a degraded dependency and logs the database error", async () => {
    const databaseError = { code: "PGRST301", message: "database unavailable" };
    hoisted.limit.mockResolvedValue({ error: databaseError });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "degraded", db: "error" });
    expect(hoisted.logError).toHaveBeenCalledWith("route", "health check failed", databaseError);
  });
});
