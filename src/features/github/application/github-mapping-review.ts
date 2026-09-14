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
    const { data: packValue, error: packError } = await supabase.from("github_mapping_packs")
      .select("id,version,title,checksum,published_at")
      .eq("version", STANDARD_GITHUB_ISO_MAPPING_PACK.version)
      .eq("checksum", STANDARD_GITHUB_ISO_MAPPING_PACK.checksum)
      .not("published_at", "is", null)
      .maybeSingle();
    const pack = packRowSchema.safeParse(packValue);
    if (packError || !pack.success) fail();

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
    if (
      !candidate.success
      || candidate.data.version !== STANDARD_GITHUB_ISO_MAPPING_PACK.version
      || candidate.data.title !== STANDARD_GITHUB_ISO_MAPPING_PACK.title
      || candidate.data.checksum !== STANDARD_GITHUB_ISO_MAPPING_PACK.checksum
    ) fail();

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
