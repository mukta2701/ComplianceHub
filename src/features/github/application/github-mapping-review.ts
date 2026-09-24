import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  STANDARD_GITHUB_ISO_MAPPING_PACK,
  mappingPackSchema,
} from "../domain/mapping";

const uuid = z.uuid();
const dateTime = z.string().datetime({ offset: true });
const packRowSchema = z.object({
  id: uuid,
  version: z.string(),
  title: z.string(),
  checksum: z.string(),
  published_at: dateTime,
}).strict();
const entryRowSchema = z.object({
  id: uuid,
  mapping_pack_id: uuid,
  check_id: z.string(),
  rule_version: z.string(),
  iso_control_references: z.array(z.string()),
  failure_severity: z.enum(["low", "medium", "high", "critical"]),
  remediation: z.string(),
  treatments: z.unknown(),
}).strict();
const approvalRowSchema = z.object({
  id: uuid,
  mapping_pack_id: uuid,
  approved_at: dateTime,
  revoked_at: dateTime.nullable(),
}).strict();
const effectiveDecisionRowSchema = z.object({
  organisation_id: uuid,
  mapping_pack_id: uuid,
  mapping_entry_id: uuid,
  check_id: z.string(),
  entry_digest: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.enum(["pending", "approved", "rejected"]),
  source: z.enum(["none", "legacy_pack", "entry_decision"]),
  decision_id: uuid.nullable(),
  legacy_approval_id: uuid.nullable(),
  reviewer_id: uuid.nullable(),
  reviewed_at: dateTime.nullable(),
  revision: z.number().int().min(0),
  change_reason: z.enum(["changed", "not_reviewed"]).nullable(),
}).strict();

const LOAD_ERROR = "Could not load the GitHub mapping review";

export const GITHUB_MAPPING_LIMITATIONS = [
  "These repository checks cover selected technical signals only; they do not certify ISO/IEC 27001 compliance.",
  "A verified technical pass is evidence for review, not proof that the mapped control is fully implemented.",
  "Unknown or not-applicable results do not create compliance-positive evidence or improve readiness.",
] as const;

export type GitHubMappingReview = {
  pack: {
    id: string;
    version: string;
    title: string;
    checksum: string;
    publishedAt: string;
  };
  entries: Array<{
    id: string;
    checkId: string;
    ruleVersion: string;
    isoControlReferences: string[];
    failureSeverity: "low" | "medium" | "high" | "critical";
    remediation: string;
    treatments: typeof STANDARD_GITHUB_ISO_MAPPING_PACK.mappings[number]["treatments"];
    review: {
      entryDigest: string;
      status: "pending" | "approved" | "rejected";
      source: "none" | "legacy_pack" | "entry_decision";
      decisionId: string | null;
      legacyApprovalId: string | null;
      reviewerId: string | null;
      reviewedAt: string | null;
      revision: number;
      changeReason: "changed" | "not_reviewed" | null;
    };
  }>;
  approvalHistory: Array<{
    id: string;
    mappingPackId: string;
    approvedAt: string;
    revokedAt: string | null;
  }>;
  limitations: readonly string[];
};

function fail(): never {
  throw new Error(LOAD_ERROR);
}

export async function loadGitHubMappingReview(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<GitHubMappingReview> {
  const parsedOrganisationId = uuid.safeParse(organisationId);
  if (!parsedOrganisationId.success) fail();

  try {
    const effectiveDecisionResult = await supabase.from("github_effective_mapping_entry_decisions")
      .select("organisation_id,mapping_pack_id,mapping_entry_id,check_id,entry_digest,status,source,decision_id,legacy_approval_id,reviewer_id,reviewed_at,revision,change_reason")
      .eq("organisation_id", parsedOrganisationId.data)
      .order("check_id", { ascending: true })
      .limit(16);
    const effectiveDecisions = z.array(effectiveDecisionRowSchema).length(15).safeParse(effectiveDecisionResult.data);
    if (effectiveDecisionResult.error || !effectiveDecisions.success) fail();
    const selectedPackId = effectiveDecisions.data[0].mapping_pack_id;
    if (effectiveDecisions.data.some((decision) => decision.organisation_id !== parsedOrganisationId.data
      || decision.mapping_pack_id !== selectedPackId)) fail();

    const { data: packValue, error: packError } = await supabase.from("github_mapping_packs")
      .select("id,version,title,checksum,published_at")
      .eq("id", selectedPackId)
      .not("published_at", "is", null)
      .maybeSingle();
    const pack = packRowSchema.safeParse(packValue);
    if (packError || !pack.success || pack.data.id !== selectedPackId) fail();

    const [entryResult, approvalResult] = await Promise.all([
      supabase.from("github_mapping_entries")
        .select("id,mapping_pack_id,check_id,rule_version,iso_control_references,failure_severity,remediation,treatments")
        .eq("mapping_pack_id", pack.data.id)
        .order("check_id", { ascending: true })
        .limit(15),
      supabase.from("github_mapping_approvals")
        .select("id,mapping_pack_id,approved_at,revoked_at")
        .eq("organisation_id", parsedOrganisationId.data)
        .order("approved_at", { ascending: false })
        .limit(20),
    ]);
    const entries = z.array(entryRowSchema).length(15).safeParse(entryResult.data);
    const approvals = z.array(approvalRowSchema).max(20).safeParse(approvalResult.data);
    if (entryResult.error || approvalResult.error || !entries.success || !approvals.success) fail();
    const reviewByEntryId = new Map(effectiveDecisions.data.map((decision) => [decision.mapping_entry_id, decision]));
    if (reviewByEntryId.size !== entries.data.length || entries.data.some((entry) => {
      const decision = reviewByEntryId.get(entry.id);
      return !decision || decision.organisation_id !== parsedOrganisationId.data
        || decision.mapping_pack_id !== pack.data.id || decision.check_id !== entry.check_id;
    })) fail();

    const candidate = mappingPackSchema.safeParse({
      version: pack.data.version,
      title: pack.data.title,
      checksum: pack.data.checksum,
      mappings: entries.data.map((entry) => ({
        checkId: entry.check_id,
        ruleVersion: entry.rule_version,
        isoControlReferences: entry.iso_control_references,
        failureSeverity: entry.failure_severity,
        remediation: entry.remediation,
        treatments: entry.treatments,
      })),
    });
    if (!candidate.success) fail();

    return {
      pack: {
        id: pack.data.id,
        version: pack.data.version,
        title: pack.data.title,
        checksum: pack.data.checksum,
        publishedAt: pack.data.published_at,
      },
      entries: entries.data.map((entry) => ({
        id: entry.id,
        checkId: entry.check_id,
        ruleVersion: entry.rule_version,
        isoControlReferences: entry.iso_control_references,
        failureSeverity: entry.failure_severity,
        remediation: entry.remediation,
        treatments: entry.treatments as GitHubMappingReview["entries"][number]["treatments"],
        review: (() => {
          const decision = reviewByEntryId.get(entry.id);
          if (!decision) fail();
          return {
            entryDigest: decision.entry_digest,
            status: decision.status,
            source: decision.source,
            decisionId: decision.decision_id,
            legacyApprovalId: decision.legacy_approval_id,
            reviewerId: decision.reviewer_id,
            reviewedAt: decision.reviewed_at,
            revision: decision.revision,
            changeReason: decision.change_reason,
          };
        })(),
      })).sort((left, right) => left.checkId.localeCompare(right.checkId)),
      approvalHistory: approvals.data.map((approval) => ({
        id: approval.id,
        mappingPackId: approval.mapping_pack_id,
        approvedAt: approval.approved_at,
        revokedAt: approval.revoked_at,
      })),
      limitations: GITHUB_MAPPING_LIMITATIONS,
    };
  } catch {
    fail();
  }
}
