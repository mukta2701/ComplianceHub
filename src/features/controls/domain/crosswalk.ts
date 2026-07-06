// Org-owned multi-framework control crosswalk domain. ISO 27001 is the base
// (the shared control library); these are the frameworks an organisation may
// map THEIR controls onto. Identifiers/labels only — never authoritative
// mapping claims (the organisation records and owns each mapping).

export type ComplianceFramework = "soc_2" | "gdpr" | "hipaa" | "nist_csf" | "iso_27017";

export const COMPLIANCE_FRAMEWORKS: readonly ComplianceFramework[] = [
  "soc_2",
  "gdpr",
  "hipaa",
  "nist_csf",
  "iso_27017",
] as const;

// en-GB display labels for each framework identifier.
export const COMPLIANCE_FRAMEWORK_LABEL: Record<ComplianceFramework, string> = {
  soc_2: "SOC 2",
  gdpr: "GDPR",
  hipaa: "HIPAA",
  nist_csf: "NIST CSF",
  iso_27017: "ISO 27017",
};

export interface CrosswalkMapping {
  framework: ComplianceFramework;
  controlId: string;
  externalRef: string;
}

export interface FrameworkCoverage {
  framework: ComplianceFramework;
  // distinct requirements (external_ref) the organisation has recorded a
  // mapping for, within this framework.
  mappedRequirements: number;
  // of those, how many are satisfied by at least one control whose SoA status
  // the organisation has marked implemented.
  coveredByImplementedControl: number;
  percent: number;
}

// Pure coverage roll-up. A framework requirement (external_ref) is "covered"
// when ANY control mapped to it is in the implemented set — overlapping
// requirements therefore share the evidence already attached to that control.
export function summariseFrameworkCoverage(
  mappings: readonly CrosswalkMapping[],
  implementedControlIds: Iterable<string>,
): FrameworkCoverage[] {
  const implemented = new Set(implementedControlIds);
  // framework -> (external_ref -> covered?), folding OR across the mapped controls.
  const byFramework = new Map<ComplianceFramework, Map<string, boolean>>();
  for (const mapping of mappings) {
    let requirements = byFramework.get(mapping.framework);
    if (!requirements) {
      requirements = new Map<string, boolean>();
      byFramework.set(mapping.framework, requirements);
    }
    const covered = implemented.has(mapping.controlId);
    requirements.set(mapping.externalRef, (requirements.get(mapping.externalRef) ?? false) || covered);
  }
  return COMPLIANCE_FRAMEWORKS.map((framework) => {
    const requirements = byFramework.get(framework);
    const mappedRequirements = requirements ? requirements.size : 0;
    const coveredByImplementedControl = requirements
      ? [...requirements.values()].filter(Boolean).length
      : 0;
    const percent = mappedRequirements === 0
      ? 0
      : Math.round((coveredByImplementedControl / mappedRequirements) * 100);
    return { framework, mappedRequirements, coveredByImplementedControl, percent };
  });
}
