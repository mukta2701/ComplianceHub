import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  createClient: vi.fn(),
  build: vi.fn(),
  run: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: hoisted.createClient }));
vi.mock("@/features/github/application/collection-deps", () => ({ buildCollectionDependencies: hoisted.build }));
vi.mock("@/features/github/application/run-collection", () => ({ runGitHubCollection: hoisted.run }));
vi.mock("@/lib/observability/logger", () => ({ logError: hoisted.logError }));

function request(secret = "secret") {
  return new Request("http://localhost/api/cron/github-collect", { method: "POST", headers: { authorization: `Bearer ${secret}` } });
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("CRON_SECRET", "secret");
  vi.stubEnv("GITHUB_APP_ID", "1");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "private");
  vi.stubEnv("GITHUB_APPROVED_SECURITY_WORKFLOW_IDS", "101");
  hoisted.createClient.mockReset().mockReturnValue({});
  hoisted.build.mockReset().mockReturnValue({});
  hoisted.run.mockReset().mockResolvedValue({ installationsChecked: 1, repositoriesChecked: 1, observationsStored: 15, repositoriesFailed: 0, repositoriesDeferred: 0, runsPartial: 0 });
  hoisted.logError.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/cron/github-collect", () => {
  it("rejects unauthorised callers before constructing dependencies", async () => {
    const { POST } = await import("./route");
    const response = await POST(request("wrong"));
    expect(response.status).toBe(401);
    expect(hoisted.createClient).not.toHaveBeenCalled();
    expect(hoisted.build).not.toHaveBeenCalled();
  });

  it("uses a deterministic UTC-day key and returns counts only", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T23:59:00.000Z"));
    const { POST } = await import("./route");
    const response = await POST(request());
    expect(hoisted.run).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ trigger: "scheduled", requestKey: "scheduled:2026-08-17", signal: expect.any(AbortSignal) }));
    expect(await response.json()).toEqual({ installationsChecked: 1, repositoriesChecked: 1, observationsStored: 15, repositoriesFailed: 0, repositoriesDeferred: 0, runsPartial: 0 });
    vi.useRealTimers();
  });

  it("logs a fixed redacted message and never the thrown provider error", async () => {
    hoisted.run.mockRejectedValue(new Error("Authorization: token-secret response-body"));
    const { POST } = await import("./route");
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(hoisted.logError).toHaveBeenCalledWith("cron", "GitHub collection cron failed", undefined, { stage: "collection" });
    expect(JSON.stringify(hoisted.logError.mock.calls)).not.toContain("token-secret");
  });
});
