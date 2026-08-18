import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  createClient: vi.fn(),
  authorised: vi.fn(),
  shouldPurge: vi.fn(),
  purgeReference: vi.fn(),
}));

vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: hoisted.createClient }));
vi.mock("@/lib/security/cron-auth", () => ({ isAuthorisedCron: hoisted.authorised }));
vi.mock("@/features/automation/domain/retention", () => ({
  shouldPurgeSourceObject: hoisted.shouldPurge,
  purgeContentReference: hoisted.purgeReference,
}));

import { POST } from "./route";

function request() {
  return new Request("http://localhost/api/cron/automation-purge", { method: "POST" });
}

function clientFor(objects: unknown[]) {
  const selectBuilder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "lte"]) selectBuilder[method] = vi.fn(() => selectBuilder);
  selectBuilder.limit = vi.fn().mockResolvedValue({ data: objects, error: null });

  const updates: unknown[] = [];
  const update = vi.fn((payload: unknown) => {
    updates.push(payload);
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    builder.eq = vi.fn(() => {
      if (builder.eq.mock.calls.length >= 3) return Promise.resolve({ error: null });
      return builder;
    });
    return builder;
  });
  return {
    updates,
    from: vi.fn((table: string) => table === "source_objects" ? {
      select: () => selectBuilder,
      update,
    } : undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.authorised.mockReturnValue(true);
  hoisted.shouldPurge.mockReturnValue(true);
  hoisted.purgeReference.mockImplementation((hash: string) => `purged://${hash}`);
});

describe("POST /api/cron/automation-purge", () => {
  it("rejects unauthorised callers before constructing a service client", async () => {
    hoisted.authorised.mockReturnValue(false);
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(hoisted.createClient).not.toHaveBeenCalled();
  });

  it("purges one bounded batch and reports deferred expired objects", async () => {
    const objects = Array.from({ length: 101 }, (_, index) => ({
      id: `object-${index}`,
      organisation_id: "org-1",
      status: "pending",
      expires_at: "2026-08-17T00:00:00.000Z",
      content_hash: `hash-${index}`,
    }));
    const client = clientFor(objects);
    hoisted.createClient.mockReturnValue(client);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ purged: 100, deferred: 1 });
    expect(client.updates).toHaveLength(100);
  });
});
