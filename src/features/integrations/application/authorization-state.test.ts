import { createHash } from "node:crypto";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  consumeAuthorizationState,
  issueAuthorizationState,
  type AuthorizationOperator,
  type AuthorizationStateDatabase,
} from "./authorization-state";

const operator: AuthorizationOperator = {
  organisationId: "89000000-0000-4000-8000-000000000001",
  userId: "89000000-0000-4000-8000-000000000002",
  role: "owner",
};

function database(overrides?: {
  insert?: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
  rpc?: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}): AuthorizationStateDatabase {
  return {
    from: vi.fn(() => ({
      insert: overrides?.insert ?? vi.fn(async () => ({ error: null })),
    })),
    rpc: overrides?.rpc ?? vi.fn(async () => ({ data: [], error: null })),
  };
}

describe("one-time provider authorization state", () => {
  it("accepts the real service-client type at its database boundary", () => {
    expectTypeOf<ReturnType<typeof createSupabaseServiceClient>>()
      .toMatchTypeOf<AuthorizationStateDatabase>();
  });

  it("mints 32 random bytes, persists only SHA-256, and expires after ten minutes", async () => {
    let inserted: Record<string, unknown> | undefined;
    const db = database({
      insert: vi.fn(async (row) => {
        inserted = row;
        return { error: null };
      }),
    });
    const now = new Date("2026-07-14T12:00:00.000Z");

    const issued = await issueAuthorizationState({
      database: db,
      resolveOperator: async () => operator,
      provider: "github",
      purpose: "github_install",
      continuation: { returnTo: "/app/settings?tab=connections" },
      now: () => now,
    });

    expect(issued.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued).not.toHaveProperty("stateHash");
    expect(issued.expiresAt).toBe("2026-07-14T12:10:00.000Z");
    expect(inserted).toEqual({
      organisation_id: operator.organisationId,
      user_id: operator.userId,
      provider: "github",
      state_hash: createHash("sha256").update(issued.state, "utf8").digest("hex"),
      purpose: "github_install",
      continuation: { returnTo: "/app/settings?tab=connections" },
      expires_at: "2026-07-14T12:10:00.000Z",
    });
    expect(JSON.stringify(inserted)).not.toContain(issued.state);

    const second = await issueAuthorizationState({
      database: database(),
      resolveOperator: async () => operator,
      provider: "github",
      purpose: "github_install",
      now: () => now,
    });
    expect(second.state).not.toBe(issued.state);
  });

  it("prunes retained authorization rows before issuing a new state", async () => {
    const rpc = vi.fn(async () => ({ data: 2, error: null }));
    const insert = vi.fn(async () => ({ error: null }));
    const db = database({ rpc, insert });

    await issueAuthorizationState({
      database: db,
      resolveOperator: async () => operator,
      provider: "github",
      purpose: "github_install",
    });

    expect(rpc).toHaveBeenCalledWith("prune_integration_authorization_states", {});
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(insert.mock.invocationCallOrder[0]);
  });

  it("sanitizes authorization-state cleanup failures and does not insert", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const db = database({
      rpc: vi.fn(async () => {
        throw new Error("postgres://service-role:provider-secret@database/cleanup");
      }),
      insert,
    });

    await expect(issueAuthorizationState({
      database: db,
      resolveOperator: async () => operator,
      provider: "github",
      purpose: "github_install",
    })).rejects.toThrow("Could not start provider authorization");
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects members, invalid purpose, and oversized continuation before persistence", async () => {
    const db = database();
    await expect(issueAuthorizationState({
      database: db,
      resolveOperator: async () => ({ ...operator, role: "member" }),
      provider: "jira",
      purpose: "jira_oauth",
    })).rejects.toThrow("Provider authorization is unavailable");
    await expect(issueAuthorizationState({
      database: db,
      resolveOperator: async () => operator,
      provider: "jira",
      purpose: "INVALID PURPOSE",
    })).rejects.toThrow("Provider authorization is unavailable");
    await expect(issueAuthorizationState({
      database: db,
      resolveOperator: async () => operator,
      provider: "github",
      purpose: "jira_oauth",
    })).rejects.toThrow("Provider authorization is unavailable");
    await expect(issueAuthorizationState({
      database: db,
      resolveOperator: async () => operator,
      provider: "jira",
      purpose: "jira_oauth",
      continuation: { padding: "x".repeat(4_100) },
    })).rejects.toThrow("Provider authorization is unavailable");
    expect(db.from).not.toHaveBeenCalled();
  });

  it("uses a fixed safe issuance error and never reflects database details", async () => {
    const db = database({
      insert: vi.fn(async () => ({ error: { message: "token=provider-secret" } })),
    });
    await expect(issueAuthorizationState({
      database: db,
      resolveOperator: async () => operator,
      provider: "jira",
      purpose: "jira_oauth",
    })).rejects.toThrow("Could not start provider authorization");
    try {
      await issueAuthorizationState({
        database: db,
        resolveOperator: async () => operator,
        provider: "jira",
        purpose: "jira_oauth",
      });
    } catch (error) {
      expect(String(error)).not.toContain("provider-secret");
    }
  });

  it("sanitizes a rejected persistence promise without reflecting transport details", async () => {
    const leaked = "postgres://service-role:provider-secret@database/state_hash_deadbeef";
    const db = database({
      insert: vi.fn(async () => {
        throw new Error(leaked);
      }),
    });

    try {
      await issueAuthorizationState({
        database: db,
        resolveOperator: async () => operator,
        provider: "github",
        purpose: "github_install",
      });
      throw new Error("expected issuance to reject");
    } catch (error) {
      expect(String(error)).toContain("Could not start provider authorization");
      expect(String(error)).not.toContain("provider-secret");
      expect(String(error)).not.toContain("state_hash_deadbeef");
      expect(String(error)).not.toContain("postgres://");
    }
  });

  it("atomically consumes state bound to the current workspace, user, provider, and purpose", async () => {
    const rawState = "a".repeat(43);
    const rpc = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
      data: [{
        id: "89000000-0000-4000-8000-000000000003",
        organisation_id: operator.organisationId,
        user_id: operator.userId,
        provider: "jira",
        purpose: "jira_oauth",
        continuation: { returnTo: "/app/settings?tab=connections" },
        created_at: "2026-07-14T12:00:00.000Z",
        expires_at: "2026-07-14T12:10:00.000Z",
        consumed_at: "2026-07-14T12:01:00.000Z",
      }],
      error: null,
      args,
    }));
    const resolveOperator = vi.fn(async () => operator);

    const consumed = await consumeAuthorizationState({
      database: database({ rpc }),
      resolveOperator,
      provider: "jira",
      purpose: "jira_oauth",
      state: rawState,
    });

    expect(rpc).toHaveBeenCalledWith("consume_integration_authorization_state", {
      candidate_state_hash: createHash("sha256").update(rawState, "utf8").digest("hex"),
      expected_organisation_id: operator.organisationId,
      expected_user_id: operator.userId,
      expected_provider: "jira",
      expected_purpose: "jira_oauth",
    });
    expect(resolveOperator).toHaveBeenCalledTimes(2);
    expect(consumed).toEqual({
      provider: "jira",
      purpose: "jira_oauth",
      continuation: { returnTo: "/app/settings?tab=connections" },
    });
    expect(consumed).not.toHaveProperty("stateHash");
    expect(JSON.stringify(consumed)).not.toContain(rawState);
  });

  it("rejects a missing or replayed state without exposing hashes or provider errors", async () => {
    const rawState = "b".repeat(43);
    for (const response of [
      { data: [], error: null },
      { data: null, error: { message: "refresh_token=provider-secret" } },
    ]) {
      const rpc = vi.fn(async () => response);
      await expect(consumeAuthorizationState({
        database: database({ rpc }),
        resolveOperator: async () => operator,
        provider: "github",
        purpose: "github_install",
        state: rawState,
      })).rejects.toThrow("Authorization state is invalid or expired");
      try {
        await consumeAuthorizationState({
          database: database({ rpc }),
          resolveOperator: async () => operator,
          provider: "github",
          purpose: "github_install",
          state: rawState,
        });
      } catch (error) {
        expect(String(error)).not.toContain(rawState);
        expect(String(error)).not.toContain("provider-secret");
        expect(String(error)).not.toContain(createHash("sha256").update(rawState).digest("hex"));
      }
    }
  });

  it("rejects wrong provider, purpose, workspace, user, or post-consumption operator", async () => {
    const baseRow = {
      id: "89000000-0000-4000-8000-000000000003",
      organisation_id: operator.organisationId,
      user_id: operator.userId,
      provider: "github",
      purpose: "github_install",
      continuation: {},
      created_at: "2026-07-14T12:00:00.000Z",
      expires_at: "2026-07-14T12:10:00.000Z",
      consumed_at: "2026-07-14T12:01:00.000Z",
    };
    const mismatches = [
      { ...baseRow, provider: "jira" },
      { ...baseRow, purpose: "jira_oauth" },
      { ...baseRow, organisation_id: "89000000-0000-4000-8000-000000000099" },
      { ...baseRow, user_id: "89000000-0000-4000-8000-000000000099" },
    ];
    for (const row of mismatches) {
      await expect(consumeAuthorizationState({
        database: database({ rpc: vi.fn(async () => ({ data: [row], error: null })) }),
        resolveOperator: async () => operator,
        provider: "github",
        purpose: "github_install",
        state: "c".repeat(43),
      })).rejects.toThrow("Authorization state is invalid or expired");
    }

    const resolveOperator = vi.fn()
      .mockResolvedValueOnce(operator)
      .mockResolvedValueOnce({ ...operator, userId: "89000000-0000-4000-8000-000000000099" });
    await expect(consumeAuthorizationState({
      database: database({ rpc: vi.fn(async () => ({ data: [baseRow], error: null })) }),
      resolveOperator,
      provider: "github",
      purpose: "github_install",
      state: "d".repeat(43),
    })).rejects.toThrow("Authorization state is invalid or expired");
  });
});
