import { EXPECTED_GITHUB_CHECK_IDS } from "./rules";

type OfficialResult = {
  checkId: string;
  outcome: "pass" | "fail" | "unknown" | "not_applicable";
  freshUntil: string;
  mappingPackId: string;
  mappingVersion: string;
  mappingChecksum: string;
  mappingStatus: "active" | "historical";
  freshness: "current" | "stale";
};

export type GitHubOfficialOutcomeCounts = {
  pass: number;
  fail: number;
  unknown: number;
  notApplicable: number;
};

export type GitHubOfficialResultCurrentness = "current" | "historical" | "stale";

export function classifyGitHubOfficialResult(
  result: Pick<OfficialResult, "mappingStatus" | "freshness">,
): GitHubOfficialResultCurrentness {
  if (result.mappingStatus === "historical") return "historical";
  return result.freshness === "current" ? "current" : "stale";
}

export type GitHubRepositoryComplianceState =
  | "needs_attention"
  | "awaiting_approval"
  | "shadow"
  | "official_stale"
  | "official_partial"
  | "official_current";

export type GitHubRepositoryComplianceInput = {
  asOf: string;
  installationHealthy: boolean;
  latestCollection: { status: "succeeded" | "partial" | "failed" | "rate_limited" } | null;
  latestMaterialisationJob: {
    status: "pending" | "awaiting_approval" | "retryable" | "completed" | "exhausted";
  } | null;
  officialResults: OfficialResult[];
};

export function countGitHubOfficialOutcomes(results: OfficialResult[]) {
  const counts: GitHubOfficialOutcomeCounts = { pass: 0, fail: 0, unknown: 0, notApplicable: 0 };
  let historical = 0;
  let stale = 0;
  for (const result of results) {
    const currentness = classifyGitHubOfficialResult(result);
    if (currentness === "historical") {
      historical += 1;
      continue;
    }
    if (currentness === "stale") {
      stale += 1;
      continue;
    }
    if (result.outcome === "not_applicable") counts.notApplicable += 1;
    else counts[result.outcome] += 1;
  }
  return { current: counts, historical, stale };
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
    || input.latestCollection?.status === "partial"
    || input.latestCollection?.status === "failed"
    || input.latestCollection?.status === "rate_limited"
    || jobStatus === "retryable"
    || jobStatus === "exhausted"
  ) return "needs_attention";

  const asOf = Date.parse(input.asOf);
  const currentResultCount = Number.isFinite(asOf)
    ? input.officialResults.filter((result) =>
      classifyGitHubOfficialResult(result) === "current"
      && Number.isFinite(Date.parse(result.freshUntil))
      && Date.parse(result.freshUntil) > asOf,
    ).length
    : 0;

  if (currentResultCount === 0) {
    if (input.officialResults.length > 0) return "official_stale";
    return jobStatus === "awaiting_approval" ? "awaiting_approval" : "shadow";
  }

  const allExpectedResultsCurrent = hasCompleteExpectedResults(input.officialResults)
    && currentResultCount === EXPECTED_GITHUB_CHECK_IDS.length;
  return allExpectedResultsCurrent ? "official_current" : "official_partial";
}
