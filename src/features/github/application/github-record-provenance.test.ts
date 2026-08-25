import { describe, expect, it, vi } from "vitest";

import {
  loadOfficialGitHubEvidenceProvenance,
  loadOfficialGitHubFindingProvenance,
  parseOfficialRecordSelection,
} from "./github-record-provenance";

const ORG = "20000000-0000-4000-8000-000000000001";
const EVIDENCE = "30000000-0000-4000-8000-000000000001";
const FINDING = "40000000-0000-4000-8000-000000000001";
const REPOSITORY = "50000000-0000-4000-8000-000000000001";
const OBSERVATION = "60000000-0000-4000-8000-000000000001";
const PACK = "91000000-0000-4000-8000-000000000001";

type Override = Record<string, unknown>;

const invalidProvenanceCases: Array<[
  label: string,
  provenanceOverride: Override,
  resultOverride: Override,
  repositoryOverride: Override,
  mappingOverride?: Override,
]> = [
  ["cross-tenant provenance", { organisation_id: "20000000-0000-4000-8000-000000000099" }, {}, {}],
  ["unsafe repository URL", {}, {}, { html_url: "https://github.com/mukta2701/ComplianceHub/../secret" }],
  ["mismatched source name", {}, {}, { full_name: "someone/else" }],
  ["raw extra result field", {}, { provider_body: "must never cross this boundary" }, {}],
  ["mismatched mapping rule", {}, {}, {}, { rule_version: "other-rule" }],
];

type Result = { data: unknown; error: unknown };

function query(result: Result) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "or", "order", "limit"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve);
  return chain;
}

function officialResult(overrides: Record<string, unknown> = {}) {
  return {
    organisation_id: ORG,
    observation_id: OBSERVATION,
    repository_id: REPOSITORY,
    mapping_pack_id: PACK,
    mapping_version: "github-iso-27001-v1",
    mapping_checksum: "b".repeat(64),
    check_id: "github.branch.force_pushes",
    rule_version: "github-repository-v1",
    outcome: "pass",
    failure_severity: null,
    catalogue_summary: "A verified technical pass was materialised as approved evidence.",
    observed_at: "2026-08-25T08:00:00.000Z",
    fresh_until: "2026-08-26T08:00:00.000Z",
    materialised_at: "2026-08-25T08:01:00.000Z",
    evidence_id: EVIDENCE,
    finding_id: null,
    ...overrides,
  };
}

function clientFor(results: Record<string, Result | Result[]>) {
  const queries = new Map<string, ReturnType<typeof query>>();
  const calls = new Map<string, number>();
  const from = vi.fn((table: string) => {
    if (!Object.hasOwn(results, table)) throw new Error(`Unexpected table: ${table}`);
    const configured = results[table]!;
    const index = calls.get(table) ?? 0;
    calls.set(table, index + 1);
    const result = Array.isArray(configured) ? configured[index] ?? configured.at(-1)! : configured;
    const built = query(result);
    queries.set(table, built);
    return built;
  });
  return { client: { from }, from, queries };
}

describe("official GitHub record provenance", () => {
  it("accepts one exact UUID selection and treats arrays or malformed values as no selection", () => {
    expect(parseOfficialRecordSelection(EVIDENCE)).toBe(EVIDENCE);
    expect(parseOfficialRecordSelection([EVIDENCE])).toBeNull();
    expect(parseOfficialRecordSelection("not-an-id")).toBeNull();
    expect(parseOfficialRecordSelection(undefined)).toBeNull();
  });

  it("loads bounded evidence provenance from official rows without touching observations", async () => {
    const { client, from, queries } = clientFor({
      github_evidence_provenance: { data: [{
        evidence_id: EVIDENCE,
        organisation_id: ORG,
        repository_id: REPOSITORY,
        observation_id: OBSERVATION,
        mapping_pack_id: PACK,
        check_id: "github.branch.force_pushes",
        rule_version: "github-repository-v1",
        mapping_version: "github-iso-27001-v1",
        observed_at: "2026-08-25T08:00:00.000Z",
        fresh_until: "2026-08-26T08:00:00.000Z",
        created_at: "2026-08-25T08:01:00.000Z",
      }], error: null },
      github_official_compliance_results: { data: [officialResult()], error: null },
      github_repositories: { data: [{ id: REPOSITORY, organisation_id: ORG, full_name: "mukta2701/ComplianceHub", html_url: "https://github.com/mukta2701/ComplianceHub" }], error: null },
      github_mapping_entries: { data: [{ mapping_pack_id: PACK, check_id: "github.branch.force_pushes", rule_version: "github-repository-v1", iso_control_references: ["A.8.25", "A.8.32"] }], error: null },
    });

    await expect(loadOfficialGitHubEvidenceProvenance(client as never, ORG, [EVIDENCE]))
      .resolves.toEqual([expect.objectContaining({
        evidenceId: EVIDENCE,
        repository: { id: REPOSITORY, name: "mukta2701/ComplianceHub", url: "https://github.com/mukta2701/ComplianceHub" },
        checkId: "github.branch.force_pushes",
        catalogueSummary: "A verified technical pass was materialised as approved evidence.",
        isoControlReferences: ["A.8.25", "A.8.32"],
        freshness: "current",
      })]);

    expect(from).not.toHaveBeenCalledWith("github_observations");
    expect(queries.get("github_evidence_provenance")?.eq).toHaveBeenCalledWith("organisation_id", ORG);
    expect(queries.get("github_evidence_provenance")?.in).toHaveBeenCalledWith("evidence_id", [EVIDENCE]);
    expect(queries.get("github_evidence_provenance")?.limit).toHaveBeenCalledWith(200);
  });

  it("loads the latest failed finding lineage and exposes only the RPC-supported human lifecycle", async () => {
    const { client } = clientFor({
      github_finding_provenance: { data: [{
        finding_id: FINDING,
        organisation_id: ORG,
        latest_repository_id: REPOSITORY,
        latest_observation_id: OBSERVATION,
        latest_mapping_pack_id: PACK,
        check_id: "github.branch.force_pushes",
        mapping_version: "github-iso-27001-v1",
        first_detected_at: "2026-08-24T08:00:00.000Z",
        most_recent_detected_at: "2026-08-25T08:00:00.000Z",
        resolved_at: null,
      }], error: null },
      github_official_compliance_results: { data: [officialResult({ outcome: "fail", failure_severity: "high", evidence_id: null, finding_id: FINDING })], error: null },
      github_repositories: { data: [{ id: REPOSITORY, organisation_id: ORG, full_name: "mukta2701/ComplianceHub", html_url: "https://github.com/mukta2701/ComplianceHub" }], error: null },
      github_mapping_entries: { data: [{ mapping_pack_id: PACK, check_id: "github.branch.force_pushes", rule_version: "github-repository-v1", iso_control_references: ["A.8.25", "A.8.32"] }], error: null },
    });

    await expect(loadOfficialGitHubFindingProvenance(client as never, ORG, [{ findingId: FINDING, status: "acknowledged" }]))
      .resolves.toEqual([expect.objectContaining({
        findingId: FINDING,
        severity: "high",
        allowedTransitions: ["open", "in_progress", "exception_requested", "risk_accepted"],
      })]);
  });

  it("fails closed when an exact GitHub finding has no provenance row", async () => {
    const { client } = clientFor({
      github_finding_provenance: { data: [], error: null },
    });

    await expect(loadOfficialGitHubFindingProvenance(client as never, ORG, [{ findingId: FINDING, status: "open" }]))
      .rejects.toThrow("Could not load official GitHub record provenance");
  });

  it("loads more than one mapping-query chunk by exact pack/check pairs", async () => {
    const count = 21;
    const evidenceIds = Array.from({ length: count }, (_, index) => `3${String(index).padStart(7, "0")}-0000-4000-8000-000000000001`);
    const observationIds = Array.from({ length: count }, (_, index) => `6${String(index).padStart(7, "0")}-0000-4000-8000-000000000001`);
    const packIds = Array.from({ length: count }, (_, index) => `9${String(index).padStart(7, "0")}-0000-4000-8000-000000000001`);
    const mappings = packIds.map((mappingPackId, index) => ({
      mapping_pack_id: mappingPackId,
      check_id: `github.test.check_${index}`,
      rule_version: "github-repository-v1",
      iso_control_references: ["A.8.25"],
    }));
    const { client, from } = clientFor({
      github_evidence_provenance: { data: evidenceIds.map((evidenceId, index) => ({
        evidence_id: evidenceId, organisation_id: ORG, repository_id: REPOSITORY,
        observation_id: observationIds[index], mapping_pack_id: packIds[index], check_id: `github.test.check_${index}`,
        rule_version: "github-repository-v1", mapping_version: `github-iso-v${index}`,
        observed_at: "2026-08-25T08:00:00.000Z", fresh_until: "2026-08-26T08:00:00.000Z",
        created_at: "2026-08-25T08:01:00.000Z",
      })), error: null },
      github_official_compliance_results: { data: evidenceIds.map((evidenceId, index) => officialResult({
        observation_id: observationIds[index], mapping_pack_id: packIds[index], mapping_version: `github-iso-v${index}`,
        check_id: `github.test.check_${index}`, evidence_id: evidenceId,
      })), error: null },
      github_repositories: { data: [{ id: REPOSITORY, organisation_id: ORG, full_name: "mukta2701/ComplianceHub", html_url: "https://github.com/mukta2701/ComplianceHub" }], error: null },
      github_mapping_entries: [
        { data: mappings.slice(0, 20), error: null },
        { data: mappings.slice(20), error: null },
      ],
    });

    await expect(loadOfficialGitHubEvidenceProvenance(client as never, ORG, evidenceIds))
      .resolves.toHaveLength(count);
    expect(from.mock.calls.filter(([table]) => table === "github_mapping_entries")).toHaveLength(2);
  });

  it.each(invalidProvenanceCases)("fails closed for %s", async (_label, provenanceOverride, resultOverride, repositoryOverride, mappingOverride = {}) => {
    const mappingRow: Override = {
      mapping_pack_id: PACK,
      check_id: "github.branch.force_pushes",
      rule_version: "github-repository-v1",
      iso_control_references: ["A.8.25"],
    };
    Object.assign(mappingRow, mappingOverride);
    const { client } = clientFor({
      github_evidence_provenance: { data: [{
        evidence_id: EVIDENCE,
        organisation_id: ORG,
        repository_id: REPOSITORY,
        observation_id: OBSERVATION,
        mapping_pack_id: PACK,
        check_id: "github.branch.force_pushes",
        rule_version: "github-repository-v1",
        mapping_version: "github-iso-27001-v1",
        observed_at: "2026-08-25T08:00:00.000Z",
        fresh_until: "2026-08-26T08:00:00.000Z",
        created_at: "2026-08-25T08:01:00.000Z",
        ...provenanceOverride,
      }], error: null },
      github_official_compliance_results: { data: [officialResult(resultOverride)], error: null },
      github_repositories: { data: [{ id: REPOSITORY, organisation_id: ORG, full_name: "mukta2701/ComplianceHub", html_url: "https://github.com/mukta2701/ComplianceHub", ...repositoryOverride }], error: null },
      github_mapping_entries: { data: [mappingRow], error: null },
    });

    await expect(loadOfficialGitHubEvidenceProvenance(client as never, ORG, [EVIDENCE]))
      .rejects.toThrow("Could not load official GitHub record provenance");
  });

  it("treats freshness equality as stale", async () => {
    const atBoundary = "2026-08-26T08:00:00.000Z";
    const { client } = clientFor({
      github_evidence_provenance: { data: [{ evidence_id: EVIDENCE, organisation_id: ORG, repository_id: REPOSITORY, observation_id: OBSERVATION, mapping_pack_id: PACK, check_id: "github.branch.force_pushes", rule_version: "github-repository-v1", mapping_version: "github-iso-27001-v1", observed_at: "2026-08-25T08:00:00.000Z", fresh_until: atBoundary, created_at: "2026-08-25T08:01:00.000Z" }], error: null },
      github_official_compliance_results: { data: [officialResult({ fresh_until: atBoundary })], error: null },
      github_repositories: { data: [{ id: REPOSITORY, organisation_id: ORG, full_name: "mukta2701/ComplianceHub", html_url: "https://github.com/mukta2701/ComplianceHub" }], error: null },
      github_mapping_entries: { data: [{ mapping_pack_id: PACK, check_id: "github.branch.force_pushes", rule_version: "github-repository-v1", iso_control_references: ["A.8.25"] }], error: null },
    });

    const [record] = await loadOfficialGitHubEvidenceProvenance(client as never, ORG, [EVIDENCE], atBoundary);
    expect(record?.freshness).toBe("stale");
  });
});
