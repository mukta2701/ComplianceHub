import { describe, expect, it } from "vitest";

import type { GitHubObservation } from "./observation";
import {
  STANDARD_GITHUB_ISO_MAPPING_PACK,
  buildMappingPackChecksum,
  mappingPackSchema,
  selectGitHubObservationTreatment,
} from "./mapping";
import { EXPECTED_GITHUB_CHECK_IDS, RULE_PACK_VERSION } from "./rules";

function observation(
  checkId: (typeof EXPECTED_GITHUB_CHECK_IDS)[number],
  result: GitHubObservation["result"],
): GitHubObservation {
  return {
    observationKey: `adtecher/portal/${checkId}/${RULE_PACK_VERSION}`,
    runId: "run-1",
    repositoryId: 101,
    checkId,
    ruleVersion: RULE_PACK_VERSION,
    subjectType: "github_repository",
    subjectId: "adtecher/portal",
    result,
    severity: result === "fail" ? "high" : null,
    title: "Test observation",
    explanation: "A deterministic test observation.",
    remediation: result === "fail" ? "Apply the approved remediation." : null,
    observedAt: "2026-08-24T12:00:00.000Z",
    freshUntil: "2026-08-26T00:00:00.000Z",
    sourceUrl: "https://github.com/adtecher/portal",
    fingerprint: "a".repeat(64),
    diagnosticCode: result === "unknown" ? "permission_denied" : null,
  };
}

function changedPack(
  change: (pack: typeof STANDARD_GITHUB_ISO_MAPPING_PACK) => void,
): typeof STANDARD_GITHUB_ISO_MAPPING_PACK {
  const pack = structuredClone(STANDARD_GITHUB_ISO_MAPPING_PACK);
  change(pack);
  pack.checksum = buildMappingPackChecksum(pack);
  return pack;
}

describe("standard GitHub ISO mapping pack", () => {
  it("has a stable, hand-checked identity and one complete mapping per expected check", () => {
    expect(STANDARD_GITHUB_ISO_MAPPING_PACK.version).toBe("github-iso-27001-v1");
    expect(STANDARD_GITHUB_ISO_MAPPING_PACK.title).toBe(
      "Standard GitHub to ISO/IEC 27001:2022 mapping pack",
    );
    expect(STANDARD_GITHUB_ISO_MAPPING_PACK.checksum).toBe(
      "b4400a3868d0011cd174e4c5faa580d8c1f93b5636aed6f11a0f8abce7ab634f",
    );
    expect(STANDARD_GITHUB_ISO_MAPPING_PACK.mappings.map((mapping) => mapping.checkId).sort()).toEqual(
      [...EXPECTED_GITHUB_CHECK_IDS].sort(),
    );
  });

  it("maps every rule version to ISO controls, failure handling, and every result treatment", () => {
    for (const mapping of STANDARD_GITHUB_ISO_MAPPING_PACK.mappings) {
      expect(mapping.ruleVersion).toBe(RULE_PACK_VERSION);
      expect(mapping.isoControlReferences.length).toBeGreaterThan(0);
      expect(mapping.failureSeverity).not.toBeNull();
      expect(mapping.remediation.length).toBeGreaterThan(0);
      expect(mapping.treatments.pass.kind).toBe("evidence");
      expect(mapping.treatments.fail.kind).toBe("finding");
      expect(mapping.treatments.unknown.kind).toBe("explanatory");
      expect(mapping.treatments.not_applicable.kind).toBe("explanatory");
    }
  });

  it("uses a canonical checksum that ignores mapping order but catches semantic changes", () => {
    const reordered = changedPack((pack) => pack.mappings.reverse());
    const changed = changedPack((pack) => {
      pack.mappings[0]!.remediation = "Use a different approved remediation.";
    });

    expect(buildMappingPackChecksum(reordered)).toBe(STANDARD_GITHUB_ISO_MAPPING_PACK.checksum);
    expect(buildMappingPackChecksum(changed)).not.toBe(STANDARD_GITHUB_ISO_MAPPING_PACK.checksum);
  });

  it.each([
    ["duplicate check IDs", (pack: typeof STANDARD_GITHUB_ISO_MAPPING_PACK) => {
      pack.mappings[1]!.checkId = pack.mappings[0]!.checkId;
    }],
    ["missing check IDs", (pack: typeof STANDARD_GITHUB_ISO_MAPPING_PACK) => {
      pack.mappings.pop();
    }],
    ["unknown check IDs", (pack: typeof STANDARD_GITHUB_ISO_MAPPING_PACK) => {
      pack.mappings[0]!.checkId = "github.unknown.check";
    }],
    ["invalid ISO control references", (pack: typeof STANDARD_GITHUB_ISO_MAPPING_PACK) => {
      pack.mappings[0]!.isoControlReferences = ["ISO-27001"];
    }],
    ["unsafe text", (pack: typeof STANDARD_GITHUB_ISO_MAPPING_PACK) => {
      pack.mappings[0]!.remediation = "<script>alert(1)</script>";
    }],
    ["overlong text", (pack: typeof STANDARD_GITHUB_ISO_MAPPING_PACK) => {
      pack.mappings[0]!.remediation = "x".repeat(401);
    }],
    ["rule-version mismatch", (pack: typeof STANDARD_GITHUB_ISO_MAPPING_PACK) => {
      pack.mappings[0]!.ruleVersion = "github-repository-v2";
    }],
  ])("rejects %s", (_name, change) => {
    const pack = changedPack(change);

    expect(() => mappingPackSchema.parse(pack)).toThrow();
  });

  it("turns public visibility into a finding, never positive evidence", () => {
    const treatment = selectGitHubObservationTreatment(
      STANDARD_GITHUB_ISO_MAPPING_PACK,
      observation("github.repository.visibility", "fail"),
    );

    expect(treatment.kind).toBe("finding");
    expect(treatment.kind).not.toBe("evidence");
  });

  it("keeps archived runtime and unavailable observations explanatory", () => {
    const archived = selectGitHubObservationTreatment(
      STANDARD_GITHUB_ISO_MAPPING_PACK,
      observation("github.workflow.security", "not_applicable"),
    );
    const unavailable = selectGitHubObservationTreatment(
      STANDARD_GITHUB_ISO_MAPPING_PACK,
      observation("github.dependabot.high_critical", "unknown"),
    );

    expect(archived.kind).toBe("explanatory");
    expect(unavailable.kind).toBe("explanatory");
  });
});
