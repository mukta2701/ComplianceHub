import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  provider: vi.fn(),
  generate: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({
  requireAppContext: vi.fn(),
}));
vi.mock("@/features/ai/application/openai-compatible", () => ({ configuredAiProvider: mocks.provider }));
vi.mock("@/features/ai/application/suggestion", () => ({ generateAiSuggestion: mocks.generate }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/features/reports/application/load-readiness", () => ({ loadReadinessInput: vi.fn() }));
vi.mock("@/features/reports/domain/readiness-report", () => ({ buildReadinessReport: vi.fn() }));

import { requireAppContext } from "@/lib/app-context";
import { POST } from "./route";

const organisation = { id: "00000000-0000-4000-8000-000000000001", name: "Workspace" };
const user = { id: "00000000-0000-4000-8000-000000000002" };

function makeSupabase(enabled: boolean) {
  return {
    from(table: string) {
      let mode: "select" | "insert" = "select";
      const builder: Record<string, unknown> = {
        select() { return builder; },
        eq() { return builder; },
        maybeSingle() {
          if (table === "ai_workspace_settings") return Promise.resolve({ data: { enabled }, error: null });
          throw new Error(`unexpected maybeSingle on ${table}`);
        },
        insert() { mode = "insert"; return builder; },
        single() {
          if (table === "ai_suggestions" && mode === "insert") return Promise.resolve({ data: { id: "suggestion-1", status: "draft", output: {}, source_references: [] }, error: null });
          throw new Error(`unexpected single on ${table}`);
        },
      };
      return builder;
    },
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/app/ai", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAppContext).mockResolvedValue({ supabase: makeSupabase(false), user, membership: { role: "member" }, organisation } as never);
  mocks.provider.mockReturnValue({ generate: vi.fn() });
  mocks.generate.mockResolvedValue({ explanation: "Explain", recommendedAction: "Review", confidence: "low", sourceReferences: [] });
});

describe("POST /api/app/ai", () => {
  it("rejects malformed target requests before provider configuration", async () => {
    const response = await POST(request({ targetType: "unknown" }));
    expect(response.status).toBe(400);
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("fails closed when the workspace has not opted in", async () => {
    const response = await POST(request({ targetType: "readiness_report" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "AI assistance is disabled for this workspace" });
  });

  it("returns an explicit configuration response for an opted-in workspace without a provider", async () => {
    vi.mocked(requireAppContext).mockResolvedValue({ supabase: makeSupabase(true), user, membership: { role: "member" }, organisation } as never);
    mocks.provider.mockReturnValue(null);
    const response = await POST(request({ targetType: "readiness_report" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "AI assistance is not configured" });
  });
});
