import { describe, expect, it } from "vitest";

import { buildMappingPackChecksum, STANDARD_GITHUB_ISO_MAPPING_PACK } from "../domain/mapping";
import { loadGitHubMappingReview } from "./github-mapping-review";

const ORG = "a1000000-0000-4000-8000-000000000001";
const PACK = "91000000-0000-4000-8000-000000000001";
const LEGACY_APPROVAL = "a1000000-0000-4000-8000-000000000099";

function effectiveEntryRows() {
  return STANDARD_GITHUB_ISO_MAPPING_PACK.mappings.map((entry, index) => ({
    organisation_id: ORG,
    mapping_pack_id: PACK,
    mapping_entry_id: `91000000-0000-4000-8000-${String(index + 101).padStart(12, "0")}`,
    check_id: entry.checkId,
    entry_digest: String(index + 1).padStart(64, "a"),
    status: "approved",
    source: "legacy_pack",
    decision_id: null as string | null,
    legacy_approval_id: LEGACY_APPROVAL as string | null,
    reviewer_id: "a1000000-0000-4000-8000-000000000001" as string | null,
    reviewed_at: "2026-08-25T07:00:00.000Z" as string | null,
    revision: 0,
    change_reason: null as string | null,
  }));
}

function rows() {
  return {
    github_mapping_packs: [{
      id: PACK,
      version: STANDARD_GITHUB_ISO_MAPPING_PACK.version,
      title: STANDARD_GITHUB_ISO_MAPPING_PACK.title,
      checksum: STANDARD_GITHUB_ISO_MAPPING_PACK.checksum,
      published_at: "2026-08-24T12:00:00.000Z",
    }],
    github_mapping_entries: STANDARD_GITHUB_ISO_MAPPING_PACK.mappings.map((entry, index) => ({
      id: `91000000-0000-4000-8000-${String(index + 101).padStart(12, "0")}`,
      mapping_pack_id: PACK,
      check_id: entry.checkId,
      rule_version: entry.ruleVersion,
      iso_control_references: entry.isoControlReferences,
      failure_severity: entry.failureSeverity,
      remediation: entry.remediation,
      treatments: entry.treatments,
    })),
    github_mapping_approvals: [{
      id: LEGACY_APPROVAL,
      mapping_pack_id: PACK,
      approved_at: "2026-08-25T07:00:00.000Z",
      revoked_at: null,
    }],
    github_effective_mapping_entry_decisions: effectiveEntryRows(),
  } as Record<string, unknown[]>;
}

function client(overrides: Partial<Record<string, unknown[]>> = {}) {
  const values = { ...rows(), ...overrides };
  const calls: Array<{ table: string; operation: string; args: unknown[] }> = [];
  return {
    calls,
    from(table: string) {
      const query: Record<string, unknown> = {};
      for (const operation of ["select", "eq", "not", "order", "limit"]) {
        query[operation] = (...args: unknown[]) => {
          calls.push({ table, operation, args });
          return query;
        };
      }
      query.maybeSingle = () => Promise.resolve({ data: values[table]?.[0] ?? null, error: null });
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: values[table] ?? [], error: null }).then(resolve);
      return query;
    },
  };
}

describe("published GitHub mapping review loader", () => {
  it("loads the exact published pack, all 15 approved entries, and identity-free approval history", async () => {
    const supabase = client();
    const review = await loadGitHubMappingReview(supabase as never, ORG);

    expect(review.pack).toMatchObject({
      id: PACK,
      version: STANDARD_GITHUB_ISO_MAPPING_PACK.version,
      checksum: STANDARD_GITHUB_ISO_MAPPING_PACK.checksum,
    });
    expect(review.entries).toHaveLength(15);
    expect(review.entries[0]).toEqual(expect.objectContaining({
      checkId: "github.administration.outside_collaborator_admins",
      isoControlReferences: ["A.5.18", "A.8.2"],
    }));
    expect(review.approvalHistory[0]).toEqual({
      id: "a1000000-0000-4000-8000-000000000099",
      mappingPackId: PACK,
      approvedAt: "2026-08-25T07:00:00.000Z",
      revokedAt: null,
    });
    expect(JSON.stringify(review.approvalHistory)).not.toContain("approved_by");
    expect(review.limitations).toHaveLength(3);
    expect(supabase.calls).toContainEqual({
      table: "github_mapping_approvals", operation: "eq", args: ["organisation_id", ORG],
    });
  });

  it("fails closed when the published rows do not exactly match the reviewed checksum semantics", async () => {
    const entries = rows().github_mapping_entries.map((row) => ({ ...(row as Record<string, unknown>) }));
    entries[0] = { ...(entries[0] as object), remediation: "Changed after publication." };
    await expect(loadGitHubMappingReview(client({ github_mapping_entries: entries }) as never, ORG))
      .rejects.toThrow("Could not load the GitHub mapping review");
  });

  it("shows an explicit rejection while retaining unchanged legacy approvals", async () => {
    const states = effectiveEntryRows();
    const rejectedIndex = states.findIndex((state) => state.check_id === "github.administration.outside_collaborator_admins");
    states[rejectedIndex] = {
      ...states[rejectedIndex],
      status: "rejected",
      source: "entry_decision",
      decision_id: "a1000000-0000-4000-8000-000000000098",
      legacy_approval_id: null,
      reviewed_at: "2026-09-23T12:00:00.000Z",
      revision: 1,
    };
    const supabase = client({ github_effective_mapping_entry_decisions: states });
    const review = await loadGitHubMappingReview(supabase as never, ORG);

    expect(review.entries[0]).toMatchObject({
      checkId: "github.administration.outside_collaborator_admins",
      review: { status: "rejected", source: "entry_decision", revision: 1 },
    });
    expect(review.entries[1].review).toMatchObject({ status: "approved", source: "legacy_pack" });
    expect(supabase.calls).toContainEqual({
      table: "github_effective_mapping_entry_decisions", operation: "eq", args: ["organisation_id", ORG],
    });
  });

  it("loads the selected immutable pack instead of silently showing the compiled seed", async () => {
    const version = "github-m2-test-v2";
    const title = "Updated mapping review";
    const mappings = STANDARD_GITHUB_ISO_MAPPING_PACK.mappings.map((entry) => ({
      ...entry,
      remediation: entry.checkId === "github.branch.stale_approvals"
        ? "Review the changed mapping before use."
        : entry.remediation,
    }));
    const checksum = buildMappingPackChecksum({ version, title, mappings });
    const fixture = rows();
    const entries = fixture.github_mapping_entries.map((row) => {
      const entry = row as Record<string, unknown>;
      return {
        ...entry,
        remediation: entry.check_id === "github.branch.stale_approvals"
          ? "Review the changed mapping before use."
          : entry.remediation,
      };
    });
    const states = effectiveEntryRows().map((row) => row.check_id === "github.branch.stale_approvals"
      ? { ...row, status: "pending", source: "none", legacy_approval_id: null,
        reviewer_id: null, reviewed_at: null, change_reason: "changed" }
      : row);
    const supabase = client({
      github_mapping_packs: [{ id: PACK, version, title, checksum, published_at: "2026-09-23T12:00:00.000Z" }],
      github_mapping_entries: entries,
      github_mapping_approvals: [],
      github_effective_mapping_entry_decisions: states,
    });

    const review = await loadGitHubMappingReview(supabase as never, ORG);

    expect(review.pack).toMatchObject({ version, checksum });
    expect(review.entries.find((entry) => entry.checkId === "github.branch.stale_approvals")?.review)
      .toMatchObject({ status: "pending", changeReason: "changed" });
    expect(supabase.calls).toContainEqual({
      table: "github_mapping_packs", operation: "eq", args: ["id", PACK],
    });
  });

  it("rejects malformed workspace input before querying", async () => {
    const supabase = client();
    await expect(loadGitHubMappingReview(supabase as never, "not-a-uuid"))
      .rejects.toThrow("Could not load the GitHub mapping review");
    expect(supabase.calls).toEqual([]);
  });
});
