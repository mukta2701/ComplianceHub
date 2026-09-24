import { describe, expect, it } from "vitest";

import { EXPECTED_GITHUB_CHECK_IDS } from "./rules";
import {
  classifyGitHubRepositoryCompliance,
  countGitHubOfficialOutcomes,
} from "./compliance-control-room-state";

const PACK = "91000000-0000-4000-8000-000000000001";
const CHECKSUM = "b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f";

function input(overrides: Record<string, unknown> = {}) {
  return {
    asOf: "2026-08-25T12:00:00.000Z",
    installationHealthy: true,
    latestCollection: { status: "succeeded" as const },
    latestMaterialisationJob: { status: "completed" as const },
    officialResults: EXPECTED_GITHUB_CHECK_IDS.map((checkId, index) => ({
      checkId,
      outcome: (["pass", "fail", "unknown", "not_applicable"] as const)[index % 4],
      freshUntil: "2026-08-26T12:00:00.000Z",
      mappingPackId: PACK,
      mappingVersion: "github-iso-27001-v1",
      mappingChecksum: CHECKSUM,
      mappingStatus: "active" as const,
      freshness: "current" as const,
    })),
    ...overrides,
  };
}

describe("GitHub official repository state", () => {
  it("calls records current for the exact active mapping, all 15 checks, and fresh results", () => {
    expect(classifyGitHubRepositoryCompliance(input())).toBe("official_current");
  });

  it("keeps complete current coverage current while a newer collection is still processing", () => {
    expect(classifyGitHubRepositoryCompliance(input({
      latestMaterialisationJob: { status: "pending" },
    }))).toBe("official_current");
  });

  it.each([
    ["unhealthy installation", { installationHealthy: false }],
    ["failed collection", { latestCollection: { status: "failed" } }],
    ["partial collection", { latestCollection: { status: "partial" } }],
    ["rate-limited collection", { latestCollection: { status: "rate_limited" } }],
    ["retryable job", { latestMaterialisationJob: { status: "retryable" } }],
    ["exhausted job", { latestMaterialisationJob: { status: "exhausted" } }],
  ])("gives Needs attention precedence for %s", (_label, override) => {
    expect(classifyGitHubRepositoryCompliance(input(override))).toBe("needs_attention");
  });

  it("shows current results for all 15 approved entries without requiring a legacy pack approval", () => {
    expect(classifyGitHubRepositoryCompliance(input())).toBe("official_current");
  });

  it("shows a partial review when one exact check is current and the other checks are still pending", () => {
    expect(classifyGitHubRepositoryCompliance(input({
      officialResults: input().officialResults.slice(0, 1),
    }))).toBe("official_partial");
  });

  it("keeps incomplete or duplicate result sets out of the fully current state without calling them a failure", () => {
    expect(classifyGitHubRepositoryCompliance(input({ officialResults: input().officialResults.slice(0, 14) }))).toBe("official_partial");
    expect(classifyGitHubRepositoryCompliance(input({
      officialResults: input().officialResults.map((result, index) => index === 14 ? { ...result, checkId: EXPECTED_GITHUB_CHECK_IDS[0] } : result),
    }))).toBe("official_partial");
  });

  it("shows Awaiting approval only when the result job explicitly waits for mapping review", () => {
    expect(classifyGitHubRepositoryCompliance(input({
      officialResults: [],
      latestMaterialisationJob: { status: "awaiting_approval" },
    }))).toBe("awaiting_approval");
  });

  it("shows Shadow for collected data that has no official records yet", () => {
    expect(classifyGitHubRepositoryCompliance(input({
      officialResults: [],
      latestMaterialisationJob: { status: "completed" },
    }))).toBe("shadow");
  });

  it.each([
    ["historical mapping", { officialResults: input().officialResults.map((result) => ({ ...result, mappingStatus: "historical" as const })) }],
    ["expired results", { officialResults: input().officialResults.map((result) => ({ ...result, freshUntil: "2026-08-25T12:00:00.000Z" })) }],
    ["stale result receipts", { officialResults: input().officialResults.map((result) => ({ ...result, freshness: "stale" as const })) }],
  ])("shows Official records stale for %s", (_label, override) => {
    expect(classifyGitHubRepositoryCompliance(input(override))).toBe("official_stale");
  });

  it("shows partial review when some current checks coexist with historical or stale records", () => {
    const results = input().officialResults.map((result, index) => index === 0
      ? { ...result, mappingStatus: "historical" as const }
      : result);
    expect(classifyGitHubRepositoryCompliance(input({ officialResults: results }))).toBe("official_partial");
  });

  it("counts only current approved results and reports old results separately", () => {
    const results = input().officialResults.map((result, index) => {
      if (index === 0) return { ...result, mappingStatus: "historical" as const };
      if (index === 1) return { ...result, freshness: "stale" as const };
      return result;
    });

    expect(countGitHubOfficialOutcomes(results)).toEqual({
      current: { pass: 3, fail: 3, unknown: 4, notApplicable: 3 },
      historical: 1,
      stale: 1,
    });
  });
});
