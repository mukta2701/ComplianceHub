import { describe, expect, it } from "vitest";
import {
  annotateCrosswalkCoverage,
  COMPLIANCE_FRAMEWORK_LABEL,
  COMPLIANCE_FRAMEWORKS,
  summariseFrameworkCoverage,
  type CrosswalkMapping,
} from "./crosswalk";

describe("COMPLIANCE_FRAMEWORK_LABEL", () => {
  it("labels every framework in en-GB", () => {
    expect(COMPLIANCE_FRAMEWORK_LABEL).toEqual({
      soc_2: "SOC 2",
      gdpr: "GDPR",
      hipaa: "HIPAA",
      nist_csf: "NIST CSF",
      iso_27017: "ISO 27017",
    });
    for (const framework of COMPLIANCE_FRAMEWORKS) {
      expect(COMPLIANCE_FRAMEWORK_LABEL[framework]).toBeTruthy();
    }
  });
});

describe("summariseFrameworkCoverage", () => {
  it("returns a zeroed row for every framework when there are no mappings", () => {
    const coverage = summariseFrameworkCoverage([], []);
    expect(coverage).toHaveLength(COMPLIANCE_FRAMEWORKS.length);
    for (const row of coverage) {
      expect(row).toMatchObject({ mappedRequirements: 0, coveredByImplementedControl: 0, percent: 0 });
    }
  });

  it("counts distinct requirements and covers a requirement when any mapped control is implemented", () => {
    const mappings: CrosswalkMapping[] = [
      { framework: "soc_2", controlId: "c1", externalRef: "CC6.1" },
      { framework: "soc_2", controlId: "c2", externalRef: "CC6.2" },
      { framework: "soc_2", controlId: "c3", externalRef: "CC7.1" },
    ];
    // c1 implemented, c2 and c3 not.
    const coverage = summariseFrameworkCoverage(mappings, ["c1"]);
    const soc2 = coverage.find((c) => c.framework === "soc_2")!;
    expect(soc2.mappedRequirements).toBe(3);
    expect(soc2.coveredByImplementedControl).toBe(1);
    expect(soc2.percent).toBe(33);
  });

  it("treats a requirement as covered if at least one of its several mapped controls is implemented", () => {
    const mappings: CrosswalkMapping[] = [
      { framework: "gdpr", controlId: "c1", externalRef: "Art.32" },
      { framework: "gdpr", controlId: "c2", externalRef: "Art.32" },
    ];
    // Only c2 implemented; the single requirement Art.32 is still covered, and
    // is counted once (distinct external_ref).
    const coverage = summariseFrameworkCoverage(mappings, ["c2"]);
    const gdpr = coverage.find((c) => c.framework === "gdpr")!;
    expect(gdpr.mappedRequirements).toBe(1);
    expect(gdpr.coveredByImplementedControl).toBe(1);
    expect(gdpr.percent).toBe(100);
  });

  it("reports full and zero coverage correctly across frameworks", () => {
    const mappings: CrosswalkMapping[] = [
      { framework: "hipaa", controlId: "c1", externalRef: "164.312(a)" },
      { framework: "nist_csf", controlId: "c2", externalRef: "PR.AC-1" },
    ];
    const coverage = summariseFrameworkCoverage(mappings, ["c1"]);
    expect(coverage.find((c) => c.framework === "hipaa")!.percent).toBe(100);
    expect(coverage.find((c) => c.framework === "nist_csf")!.percent).toBe(0);
    expect(coverage.find((c) => c.framework === "iso_27017")!.mappedRequirements).toBe(0);
  });
});

describe("annotateCrosswalkCoverage", () => {
  it("gives every row for one recorded requirement the same OR-derived coverage status", () => {
    const mappings: CrosswalkMapping[] = [
      { framework: "gdpr", controlId: "c1", externalRef: "Art.32" },
      { framework: "gdpr", controlId: "c2", externalRef: "Art.32" },
      { framework: "gdpr", controlId: "c3", externalRef: "Art.33" },
    ];

    expect(annotateCrosswalkCoverage(mappings, ["c2"])).toEqual([
      { ...mappings[0], covered: true },
      { ...mappings[1], covered: true },
      { ...mappings[2], covered: false },
    ]);
  });
});
