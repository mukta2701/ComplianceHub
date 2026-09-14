import { describe, expect, it } from "vitest";

import { STANDARD_GITHUB_ISO_MAPPING_PACK } from "../domain/mapping";
import { loadGitHubMappingReview } from "./github-mapping-review";

const ORG = "a1000000-0000-4000-8000-000000000001";
const PACK = "91000000-0000-4000-8000-000000000001";

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
      id: "a1000000-0000-4000-8000-000000000099",
      mapping_pack_id: PACK,
      approved_at: "2026-08-25T07:00:00.000Z",
      revoked_at: null,
    }],
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

  it("rejects malformed workspace input before querying", async () => {
    const supabase = client();
    await expect(loadGitHubMappingReview(supabase as never, "not-a-uuid"))
      .rejects.toThrow("Could not load the GitHub mapping review");
    expect(supabase.calls).toEqual([]);
  });
});
