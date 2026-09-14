import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  requireContext: vi.fn(),
  maybeSingle: vi.fn(),
  builder: null as Record<string, ReturnType<typeof vi.fn>> | null,
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: hoisted.requireContext }));

import { PATCH } from "./route";

function request(body: string) {
  return new Request("http://localhost/api/app/ai/suggestions/00000000-0000-4000-8000-000000000099", {
    method: "PATCH",
    body,
    headers: { "content-type": "application/json" },
  });
}

function context() {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["update", "eq", "select"]) builder[method] = vi.fn(() => builder);
  builder.maybeSingle = hoisted.maybeSingle;
  hoisted.builder = builder;
  return {
    supabase: { from: vi.fn(() => builder) },
    user: { id: "00000000-0000-4000-8000-000000000002" },
    organisation: { id: "00000000-0000-4000-8000-000000000001" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.requireContext.mockResolvedValue(context());
  hoisted.maybeSingle.mockResolvedValue({ data: { id: "suggestion-1" }, error: null });
});

describe("PATCH /api/app/ai/suggestions/[id]", () => {
  it("returns a safe 400 for invalid JSON", async () => {
    const response = await PATCH(request("{not-json"), { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000099" }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid review state" });
    expect(hoisted.requireContext).not.toHaveBeenCalled();
  });

  it("updates only the requester's suggestion in the active organisation", async () => {
    const response = await PATCH(request(JSON.stringify({ status: "accepted" })), { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000099" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "accepted" });
    expect(hoisted.builder?.eq).toHaveBeenCalledWith("organisation_id", "00000000-0000-4000-8000-000000000001");
    expect(hoisted.builder?.eq).toHaveBeenCalledWith("requester_id", "00000000-0000-4000-8000-000000000002");
  });
});
