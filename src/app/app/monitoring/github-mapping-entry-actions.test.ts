import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordGitHubMappingEntryDecisionAction } from "./github-control-room-actions";

const ORGANISATION_ID = "a1000000-0000-4000-8000-000000000001";
const USER_ID = "a1000000-0000-4000-8000-000000000002";
const PACK_ID = "a1000000-0000-4000-8000-000000000003";
const ENTRY_ID = "a1000000-0000-4000-8000-000000000004";
const DECISION_ID = "a1000000-0000-4000-8000-000000000005";
const ENTRY_DIGEST = "a".repeat(64);

const hoisted = vi.hoisted(() => ({
  role: "owner" as "owner" | "admin" | "member",
  rows: {} as Record<string, { data: unknown; error: unknown }>,
  calls: [] as string[],
  rateLimit: vi.fn(),
  serviceRpc: vi.fn(),
  revalidate: vi.fn(),
}));

function sessionClient() {
  return {
    from(table: string) {
      hoisted.calls.push(`from:${table}`);
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "limit"]) {
        query[method] = (...args: unknown[]) => {
          hoisted.calls.push(`${table}:${method}:${JSON.stringify(args)}`);
          return query;
        };
      }
      query.maybeSingle = () => Promise.resolve(hoisted.rows[table] ?? { data: null, error: null });
      return query;
    },
  };
}

vi.mock("@/lib/app-context", () => ({
  requireAppContext: () => Promise.resolve({
    supabase: sessionClient(),
    organisation: { id: ORGANISATION_ID },
    user: { id: USER_ID },
    membership: { role: hoisted.role },
  }),
}));
vi.mock("@/lib/security/rate-limit", () => ({
  enforceRateLimit: (...args: unknown[]) => {
    hoisted.calls.push("rate-limit");
    return hoisted.rateLimit(...args);
  },
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => {
    hoisted.calls.push("service-client");
    return { rpc: hoisted.serviceRpc };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidate }));

function decisionForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  form.set("entryId", ENTRY_ID);
  form.set("entryDigest", ENTRY_DIGEST);
  form.set("decision", "approved");
  form.set("expectedRevision", "4");
  for (const [key, value] of Object.entries(overrides)) form.set(key, value);
  return form;
}

describe("GitHub mapping entry decision action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.calls.length = 0;
    hoisted.role = "owner";
    hoisted.rows = {
      github_effective_mapping_entry_decisions: { data: {
        organisation_id: ORGANISATION_ID,
        mapping_pack_id: PACK_ID,
        mapping_entry_id: ENTRY_ID,
        entry_digest: ENTRY_DIGEST,
        status: "pending",
        revision: 4,
      }, error: null },
    };
    hoisted.rateLimit.mockResolvedValue(undefined);
    hoisted.serviceRpc.mockResolvedValue({ data: DECISION_ID, error: null });
  });

  it("records a decision for the current selected entry with the signed-in owner", async () => {
    await expect(recordGitHubMappingEntryDecisionAction(decisionForm())).resolves.toEqual({
      ok: true,
      message: "GitHub check approved.",
    });
    expect(hoisted.calls).toContain("from:github_effective_mapping_entry_decisions");
    expect(hoisted.rateLimit).toHaveBeenCalledWith(
      `github-mapping-entry-decision:${ORGANISATION_ID}:${USER_ID}`,
      { limit: 30, windowMs: 60_000 },
    );
    expect(hoisted.serviceRpc).toHaveBeenCalledWith("record_github_mapping_entry_decision_server", {
      target_organisation_id: ORGANISATION_ID,
      target_actor_id: USER_ID,
      target_mapping_entry_id: ENTRY_ID,
      target_entry_digest: ENTRY_DIGEST,
      target_decision: "approved",
      expected_revision: 4,
    });
    expect(hoisted.calls.indexOf("rate-limit")).toBeLessThan(hoisted.calls.indexOf("service-client"));
    expect(hoisted.revalidate.mock.calls).toEqual([["/app/monitoring"]]);
  });

  it("records a rejection for that same exact entry", async () => {
    await expect(recordGitHubMappingEntryDecisionAction(decisionForm({ decision: "rejected" }))).resolves.toEqual({
      ok: true,
      message: "GitHub check rejected.",
    });
    expect(hoisted.serviceRpc).toHaveBeenCalledWith("record_github_mapping_entry_decision_server", expect.objectContaining({
      target_mapping_entry_id: ENTRY_ID,
      target_entry_digest: ENTRY_DIGEST,
      target_decision: "rejected",
      expected_revision: 4,
    }));
  });

  it.each(["admin", "member"] as const)("denies %s before reading or writing review data", async (role) => {
    hoisted.role = role;
    await expect(recordGitHubMappingEntryDecisionAction(decisionForm())).resolves.toEqual({
      ok: false,
      message: "Only a workspace Owner can approve GitHub compliance mappings.",
    });
    expect(hoisted.calls).toEqual([]);
    expect(hoisted.serviceRpc).not.toHaveBeenCalled();
    expect(hoisted.revalidate).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed entry id", { entryId: "not-a-uuid" }],
    ["malformed digest", { entryDigest: "bad" }],
    ["unsupported decision", { decision: "skipped" }],
    ["non-decimal revision", { expectedRevision: "4.0" }],
    ["unsafe revision", { expectedRevision: "9007199254740992" }],
  ])("rejects %s before database work", async (_name, values) => {
    await expect(recordGitHubMappingEntryDecisionAction(decisionForm(values))).resolves.toMatchObject({ ok: false });
    expect(hoisted.calls).toEqual([]);
    expect(hoisted.serviceRpc).not.toHaveBeenCalled();
  });

  it("uses the signed-in workspace when an attacker submits a different organisation", async () => {
    await recordGitHubMappingEntryDecisionAction(decisionForm({ organisationId: "b1000000-0000-4000-8000-000000000001" }));
    expect(hoisted.serviceRpc).toHaveBeenCalledWith("record_github_mapping_entry_decision_server", expect.objectContaining({
      target_organisation_id: ORGANISATION_ID,
      target_actor_id: USER_ID,
    }));
  });

  it.each([
    ["a different selected entry", { mapping_entry_id: "a1000000-0000-4000-8000-000000000099" }],
    ["a changed entry digest", { entry_digest: "b".repeat(64) }],
    ["a newer review revision", { revision: 5 }],
  ])("stops when the server finds %s", async (_name, change) => {
    hoisted.rows.github_effective_mapping_entry_decisions = {
      data: {
        organisation_id: ORGANISATION_ID,
        mapping_pack_id: PACK_ID,
        mapping_entry_id: ENTRY_ID,
        entry_digest: ENTRY_DIGEST,
        status: "pending",
        revision: 4,
        ...change,
      },
      error: null,
    };
    await expect(recordGitHubMappingEntryDecisionAction(decisionForm())).resolves.toMatchObject({ ok: false });
    expect(hoisted.rateLimit).not.toHaveBeenCalled();
    expect(hoisted.serviceRpc).not.toHaveBeenCalled();
    expect(hoisted.revalidate).not.toHaveBeenCalled();
  });

  it("returns a safe stale-review message when the RPC detects a concurrent decision", async () => {
    hoisted.serviceRpc.mockResolvedValue({ data: null, error: { code: "40001" } });
    await expect(recordGitHubMappingEntryDecisionAction(decisionForm())).resolves.toMatchObject({
      ok: false,
      message: expect.stringMatching(/changed|refresh/i),
    });
    expect(hoisted.revalidate).not.toHaveBeenCalled();
  });

  it("does not expose internal rate-limit or database errors", async () => {
    hoisted.rateLimit.mockRejectedValue(new Error("private limiter detail"));
    const result = await recordGitHubMappingEntryDecisionAction(decisionForm());
    expect(result).toEqual({ ok: false, message: "Could not save this GitHub check decision." });
    expect(JSON.stringify(result)).not.toContain("private limiter detail");
    expect(hoisted.serviceRpc).not.toHaveBeenCalled();
    expect(hoisted.revalidate).not.toHaveBeenCalled();
  });
});
