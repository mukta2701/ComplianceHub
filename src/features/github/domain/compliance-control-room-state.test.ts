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
    approval: { mappingPackId: PACK, version: "github-iso-27001-v1", checksum: CHECKSUM },
    latestCollection: { status: "succeeded" as const },
    latestMaterialisationJob: { status: "completed" as const },
    officialResults: EXPECTED_GITHUB_CHECK_IDS.map((checkId, index) => ({
      checkId,
      outcome: (["pass", "fail", "unknown", "not_applicable"] as const)[index % 4],
      freshUntil: "2026-08-26T12:00:00.000Z",
      mappingPackId: PACK,
      mappingVersion: "github-iso-27001-v1",
      mappingChecksum: CHECKSUM,
    })),
    ...overrides,
  };
}

describe("GitHub official repository state", () => {
  it("calls records current only for the exact active mapping, all 15 checks, a completed job, and fresh results", () => {
    expect(classifyGitHubRepositoryCompliance(input())).toBe("official_current");
  });

  it.each([
    ["unhealthy installation", { installationHealthy: false }],
    ["failed collection", { latestCollection: { status: "failed" } }],
    ["rate-limited collection", { latestCollection: { status: "rate_limited" } }],
    ["retryable job", { latestMaterialisationJob: { status: "retryable" } }],
    ["exhausted job", { latestMaterialisationJob: { status: "exhausted" } }],
    ["incomplete results", { officialResults: input().officialResults.slice(0, 14) }],
    ["duplicate checks", { officialResults: input().officialResults.map((result, index) => index === 14 ? { ...result, checkId: EXPECTED_GITHUB_CHECK_IDS[0] } : result) }],
  ])("gives Needs attention precedence for %s", (_label, override) => {
    expect(classifyGitHubRepositoryCompliance(input(override))).toBe("needs_attention");
  });

  it("shows Awaiting approval before Shadow when no active mapping is approved", () => {
    expect(classifyGitHubRepositoryCompliance(input({ approval: null, officialResults: [] }))).toBe("awaiting_approval");
  });

  it("shows Shadow for collected data that has no official records yet", () => {
    expect(classifyGitHubRepositoryCompliance(input({ officialResults: [], latestMaterialisationJob: null }))).toBe("shadow");
  });

  it.each([
    ["historical mapping", { officialResults: input().officialResults.map((result) => ({ ...result, mappingVersion: "github-iso-27001-v0" })) }],
    ["historical mapping pack", { officialResults: input().officialResults.map((result) => ({ ...result, mappingPackId: "91000000-0000-4000-8000-000000000099" })) }],
    ["historical mapping checksum", { officialResults: input().officialResults.map((result) => ({ ...result, mappingChecksum: "a".repeat(64) })) }],
    ["expired result", { officialResults: input().officialResults.map((result, index) => index === 0 ? { ...result, freshUntil: "2026-08-25T12:00:00.000Z" } : result) }],
  ])("shows Official records stale for %s", (_label, override) => {
    expect(classifyGitHubRepositoryCompliance(input(override))).toBe("official_stale");
  });

  it("counts the four outcomes without turning unknown into a pass", () => {
    expect(countGitHubOfficialOutcomes(input().officialResults)).toEqual({
      pass: 4,
      fail: 4,
      unknown: 4,
      notApplicable: 3,
    });
  });
});
