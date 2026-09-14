import { EXPECTED_GITHUB_CHECK_IDS } from "./rules";

type MappingIdentity = {
  mappingPackId: string;
  version: string;
  checksum: string;
};

type OfficialResult = {
  checkId: string;
  outcome: "pass" | "fail" | "unknown" | "not_applicable";
  freshUntil: string;
  mappingPackId: string;
  mappingVersion: string;
  mappingChecksum: string;
};

export type GitHubRepositoryComplianceState =
  | "needs_attention"
  | "awaiting_approval"
  | "shadow"
  | "official_stale"
  | "official_current";

export type GitHubRepositoryComplianceInput = {
  asOf: string;
  installationHealthy: boolean;
  approval: MappingIdentity | null;
  latestCollection: { status: "succeeded" | "partial" | "failed" | "rate_limited" } | null;
  latestMaterialisationJob: {
    status: "pending" | "awaiting_approval" | "retryable" | "completed" | "exhausted";
  } | null;
  officialResults: OfficialResult[];
};

export function countGitHubOfficialOutcomes(results: OfficialResult[]) {
  const counts = { pass: 0, fail: 0, unknown: 0, notApplicable: 0 };
  for (const result of results) {
    if (result.outcome === "not_applicable") counts.notApplicable += 1;
    else counts[result.outcome] += 1;
  }
  return counts;
}

function hasCompleteExpectedResults(results: OfficialResult[]): boolean {
  if (results.length !== EXPECTED_GITHUB_CHECK_IDS.length) return false;
  const expected = new Set<string>(EXPECTED_GITHUB_CHECK_IDS);
  const actual = new Set(results.map((result) => result.checkId));
  return actual.size === expected.size && [...expected].every((checkId) => actual.has(checkId));
}

export function classifyGitHubRepositoryCompliance(
  input: GitHubRepositoryComplianceInput,
): GitHubRepositoryComplianceState {
  const jobStatus = input.latestMaterialisationJob?.status;
  if (
    !input.installationHealthy
    || input.latestCollection?.status === "failed"
    || input.latestCollection?.status === "rate_limited"
    || jobStatus === "retryable"
    || jobStatus === "exhausted"
    || (input.officialResults.length > 0 && !hasCompleteExpectedResults(input.officialResults))
  ) return "needs_attention";

  if (!input.approval) return "awaiting_approval";
  if (input.officialResults.length === 0) return "shadow";

  const asOf = Date.parse(input.asOf);
  const allCurrent = Number.isFinite(asOf)
    && jobStatus === "completed"
    && hasCompleteExpectedResults(input.officialResults)
    && input.officialResults.every((result) =>
      result.mappingPackId === input.approval?.mappingPackId
      && result.mappingVersion === input.approval?.version
      && result.mappingChecksum === input.approval?.checksum
      && Number.isFinite(Date.parse(result.freshUntil))
      && Date.parse(result.freshUntil) > asOf,
    );
  return allCurrent ? "official_current" : "official_stale";
}
