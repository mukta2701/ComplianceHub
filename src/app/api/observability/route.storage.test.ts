import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), logError: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ rpc: state.rpc }) }));
vi.mock("@/lib/observability/logger", () => ({ logError: state.logError }));
import { POST } from "./route";
const request = () => new Request("http://localhost/api/observability", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ digest: "synthetic-test-digest" }) });
describe("observability with the real durable limiter", () => {
  beforeEach(() => { vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-local-key"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321"); state.rpc.mockReset(); state.logError.mockReset().mockResolvedValue(undefined); });
  afterEach(() => vi.unstubAllEnvs());
  it("rejects repeated storage failures without falling back or creating error records", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "synthetic storage failure" } });
    for (let i = 0; i < 35; i++) expect((await POST(request())).status).toBe(503);
    expect(state.logError).not.toHaveBeenCalled();
  });
  it.each([null, "not-a-number", 0, -1, 1.5])("rejects an invalid durable counter %s", async (data) => {
    state.rpc.mockResolvedValue({ data, error: null });
    expect((await POST(request())).status).toBe(503);
    expect(state.logError).not.toHaveBeenCalled();
  });
  it("also rejects failure of the per-address counter after a successful global reservation", async () => {
    state.rpc.mockResolvedValueOnce({ data: 1, error: null }).mockRejectedValueOnce(new Error("offline"));
    expect((await POST(request())).status).toBe(503);
    expect(state.logError).not.toHaveBeenCalled();
  });
  it("fails closed if durable storage is not configured", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect((await POST(request())).status).toBe(503);
    expect(state.rpc).not.toHaveBeenCalled(); expect(state.logError).not.toHaveBeenCalled();
  });
  it("keeps legitimate logging and normal rate-limit denial distinct", async () => {
    state.rpc.mockResolvedValue({ data: 1, error: null });
    expect((await POST(request())).status).toBe(200);
    expect(state.logError).toHaveBeenCalledTimes(1);
    state.logError.mockClear(); state.rpc.mockResolvedValue({ data: 301, error: null });
    expect((await POST(request())).status).toBe(429);
    expect(state.logError).not.toHaveBeenCalled();
  });
});
