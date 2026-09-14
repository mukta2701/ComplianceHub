import { createHash } from "node:crypto";

import { z } from "zod";

import type { GitHubObservation, ObservationResult, ObservationSeverity } from "./observation";
import {
  EXPECTED_GITHUB_CHECK_IDS,
  RULE_PACK_VERSION,
  type ExpectedGitHubCheckId,
} from "./rules";

const ISO_CONTROL_REFERENCE = /^A\.(?:5|6|7|8)\.\d{1,2}$/;
const SAFE_TEXT = /^[^<>\p{C}]+$/u;

const safeText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).regex(SAFE_TEXT, "Text contains unsafe characters");

const mappingTreatmentSchema = z.object({
  kind: z.enum(["evidence", "finding", "explanatory"]),
  summary: safeText(280),
}).strict();

type MappingTreatmentKind = z.infer<typeof mappingTreatmentSchema>["kind"];

const REQUIRED_TREATMENT_KINDS = {
  pass: "evidence",
  fail: "finding",
  unknown: "explanatory",
  not_applicable: "explanatory",
} as const satisfies Record<ObservationResult, MappingTreatmentKind>;

const mappingSchema = z.object({
  checkId: safeText(120),
  ruleVersion: safeText(80),
  isoControlReferences: z.array(z.string().regex(ISO_CONTROL_REFERENCE, "Invalid ISO control reference")).min(1).max(4),
  failureSeverity: z.enum(["low", "medium", "high", "critical"]),
  remediation: safeText(400),
  treatments: z.object({
    pass: mappingTreatmentSchema,
    fail: mappingTreatmentSchema,
    unknown: mappingTreatmentSchema,
    not_applicable: mappingTreatmentSchema,
  }).strict(),
}).strict();

const mappingPackShape = z.object({
  version: safeText(80),
  title: safeText(160),
  checksum: z.string().regex(/^[a-f0-9]{64}$/, "Checksum must be a SHA-256 hex digest"),
  mappings: z.array(mappingSchema).length(EXPECTED_GITHUB_CHECK_IDS.length),
}).strict();

export const mappingPackSchema = mappingPackShape.superRefine((pack, context) => {
  const expectedCheckIds = new Set<string>(EXPECTED_GITHUB_CHECK_IDS);
  const seenCheckIds = new Set<string>();

  for (const [index, mapping] of pack.mappings.entries()) {
    if (!expectedCheckIds.has(mapping.checkId)) {
      context.addIssue({ code: "custom", path: ["mappings", index, "checkId"], message: "Unknown GitHub check ID" });
    }
    if (seenCheckIds.has(mapping.checkId)) {
      context.addIssue({ code: "custom", path: ["mappings", index, "checkId"], message: "Duplicate GitHub check ID" });
    }
    seenCheckIds.add(mapping.checkId);
    if (mapping.ruleVersion !== RULE_PACK_VERSION) {
      context.addIssue({ code: "custom", path: ["mappings", index, "ruleVersion"], message: "Mapping rule version must match the active rule pack" });
    }
    for (const [result, expectedKind] of Object.entries(REQUIRED_TREATMENT_KINDS) as Array<[ObservationResult, MappingTreatmentKind]>) {
      if (mapping.treatments[result].kind !== expectedKind) {
        context.addIssue({
          code: "custom",
          path: ["mappings", index, "treatments", result, "kind"],
          message: `${result} treatment must be ${expectedKind}`,
        });
      }
    }
  }

  for (const checkId of EXPECTED_GITHUB_CHECK_IDS) {
    if (!seenCheckIds.has(checkId)) {
      context.addIssue({ code: "custom", path: ["mappings"], message: `Missing GitHub check ID: ${checkId}` });
    }
  }

  if (pack.checksum !== buildMappingPackChecksum(pack)) {
    context.addIssue({ code: "custom", path: ["checksum"], message: "Checksum does not match the canonical mapping pack" });
  }
});

export type GitHubMappingPack = z.infer<typeof mappingPackSchema>;
export type GitHubMapping = GitHubMappingPack["mappings"][number];
export type GitHubMappingTreatment = GitHubMapping["treatments"][ObservationResult];

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function buildMappingPackChecksum(
  pack: Pick<GitHubMappingPack, "version" | "title" | "mappings">,
): string {
  const canonicalPack = {
    version: pack.version,
    title: pack.title,
    mappings: [...pack.mappings]
      .map((mapping) => ({ ...mapping, isoControlReferences: [...mapping.isoControlReferences].sort() }))
      .sort((left, right) => left.checkId.localeCompare(right.checkId)),
  };

  return createHash("sha256").update(canonicalJson(canonicalPack)).digest("hex");
}

type MappingDefinition = Pick<GitHubMapping, "isoControlReferences" | "failureSeverity" | "remediation">;

function definitionFor(checkId: ExpectedGitHubCheckId): MappingDefinition {
  switch (checkId) {
    case "github.repository.visibility":
      return { isoControlReferences: ["A.8.4"], failureSeverity: "high", remediation: "Restrict repository visibility unless public access is explicitly approved." };
    case "github.repository.archived":
      return { isoControlReferences: ["A.8.32"], failureSeverity: "low", remediation: "Confirm the archive state before returning the repository to active service." };
    case "github.branch.force_pushes":
      return { isoControlReferences: ["A.8.25", "A.8.32"], failureSeverity: "high", remediation: "Block force pushes on the default branch." };
    case "github.branch.deletions":
      return { isoControlReferences: ["A.8.25", "A.8.32"], failureSeverity: "high", remediation: "Block deletion of the default branch." };
    case "github.branch.approving_reviews":
      return { isoControlReferences: ["A.8.25", "A.8.32"], failureSeverity: "high", remediation: "Require at least two approving reviews on the default branch." };
    case "github.branch.stale_approvals":
      return { isoControlReferences: ["A.8.32"], failureSeverity: "medium", remediation: "Dismiss stale approvals when new commits are pushed." };
    case "github.branch.code_owner_reviews":
      return { isoControlReferences: ["A.8.25"], failureSeverity: "medium", remediation: "Require review from code owners on the default branch." };
    case "github.branch.status_checks":
      return { isoControlReferences: ["A.8.29", "A.8.32"], failureSeverity: "high", remediation: "Require at least one status check on the default branch." };
    case "github.dependabot.high_critical":
      return { isoControlReferences: ["A.8.8"], failureSeverity: "high", remediation: "Resolve or formally triage high and critical Dependabot alerts." };
    case "github.code_scanning.high_critical":
      return { isoControlReferences: ["A.8.29"], failureSeverity: "high", remediation: "Resolve or formally triage high and critical code-scanning alerts." };
    case "github.secret_scanning.enabled":
      return { isoControlReferences: ["A.8.12", "A.8.28"], failureSeverity: "critical", remediation: "Enable GitHub secret scanning for this repository." };
    case "github.secret_scanning.push_protection":
      return { isoControlReferences: ["A.8.12", "A.8.28"], failureSeverity: "critical", remediation: "Enable push protection for GitHub secret scanning." };
    case "github.secret_scanning.open_alerts":
      return { isoControlReferences: ["A.8.12", "A.8.28"], failureSeverity: "critical", remediation: "Resolve or formally triage all open secret-scanning alerts." };
    case "github.workflow.security":
      return { isoControlReferences: ["A.8.25", "A.8.29"], failureSeverity: "high", remediation: "Enable an approved security workflow and resolve its failures." };
    case "github.administration.outside_collaborator_admins":
      return { isoControlReferences: ["A.5.18", "A.8.2"], failureSeverity: "high", remediation: "Remove administrator access from outside collaborators." };
  }
}

function treatmentsFor(checkId: ExpectedGitHubCheckId): GitHubMapping["treatments"] {
  return {
    pass: { kind: "evidence", summary: `A passing ${checkId} observation provides approved GitHub evidence.` },
    fail: { kind: "finding", summary: `A failed ${checkId} observation creates or refreshes a finding.` },
    unknown: { kind: "explanatory", summary: `GitHub could not establish ${checkId}; no compliance-positive record is created.` },
    not_applicable: { kind: "explanatory", summary: `${checkId} is not applicable to the observed repository state.` },
  };
}

const standardMappings: GitHubMapping[] = EXPECTED_GITHUB_CHECK_IDS.map((checkId) => ({
  checkId,
  ruleVersion: RULE_PACK_VERSION,
  ...definitionFor(checkId),
  treatments: treatmentsFor(checkId),
}));

const standardPack = {
  version: "github-iso-27001-v1",
  title: "Standard GitHub to ISO/IEC 27001:2022 mapping pack",
  mappings: standardMappings,
};

export const STANDARD_GITHUB_ISO_MAPPING_PACK: GitHubMappingPack = mappingPackSchema.parse({
  ...standardPack,
  checksum: buildMappingPackChecksum(standardPack),
});

export type GitHubObservationTreatment = {
  mapping: GitHubMapping;
  kind: GitHubMappingTreatment["kind"];
  summary: string;
  isoControlReferences: string[];
  failureSeverity: ObservationSeverity;
  remediation: string;
};

export function selectGitHubObservationTreatment(
  pack: GitHubMappingPack,
  observation: GitHubObservation,
): GitHubObservationTreatment {
  const parsedPack = mappingPackSchema.parse(pack);
  const mapping = parsedPack.mappings.find((candidate) => candidate.checkId === observation.checkId);

  if (!mapping) throw new TypeError(`No mapping exists for GitHub check ID: ${observation.checkId}`);
  if (mapping.ruleVersion !== observation.ruleVersion) {
    throw new TypeError(`Observation rule version does not match mapping for GitHub check ID: ${observation.checkId}`);
  }

  const treatment = mapping.treatments[observation.result];
  return {
    mapping,
    kind: treatment.kind,
    summary: treatment.summary,
    isoControlReferences: mapping.isoControlReferences,
    failureSeverity: mapping.failureSeverity,
    remediation: mapping.remediation,
  };
}
