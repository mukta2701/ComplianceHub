import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ReadinessReport } from "@/features/reports/domain/readiness-report";
import { one } from "@/lib/supabase/one";

const boundedCount = z.number().int().min(0).max(1_000_000);

export const readinessReportSchema = z.object({
  soaPercent: z.number().int().min(0).max(100),
  soaTotal: boundedCount,
  riskBands: z.object({
    low: boundedCount,
    moderate: boundedCount,
    high: boundedCount,
    very_high: boundedCount,
  }).strict(),
  tasksOpen: boundedCount,
  tasksOverdue: boundedCount,
  evidence: z.object({
    total: boundedCount,
    expiring: boundedCount,
    expired: boundedCount,
  }).strict(),
  openAudits: boundedCount,
  openNonConformities: boundedCount,
}).strict().superRefine((report, context) => {
  if (report.tasksOverdue > report.tasksOpen) {
    context.addIssue({ code: "custom", path: ["tasksOverdue"], message: "Overdue tasks cannot exceed open tasks" });
  }
  if (report.evidence.expiring + report.evidence.expired > report.evidence.total) {
    context.addIssue({ code: "custom", path: ["evidence"], message: "Stale evidence cannot exceed total evidence" });
  }
});

const snapshotRowSchema = z.object({
  id: z.uuid(),
  organisation_name: z.string().min(1).max(200),
  payload: readinessReportSchema,
  published_at: z.string().datetime({ offset: true }),
  publisher: z.union([
    z.object({ display_name: z.string().nullable() }),
    z.array(z.object({ display_name: z.string().nullable() })),
    z.null(),
  ]),
});

export type LeadershipSnapshot = {
  id: string;
  organisationName: string;
  payload: ReadinessReport;
  publishedAt: string;
  publisherName: string | null;
};

export async function loadLatestLeadershipSnapshot(
  supabase: SupabaseClient,
  organisationId: string,
): Promise<LeadershipSnapshot | null> {
  const { data, error } = await supabase
    .from("leadership_report_snapshots")
    .select("id,organisation_name,payload,published_at,publisher:profiles!leadership_report_snapshots_published_by_fkey(display_name)")
    .eq("organisation_id", organisationId)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Could not load the published leadership report");
  if (!data) return null;
  const parsed = snapshotRowSchema.safeParse(data);
  if (!parsed.success) throw new Error("Published leadership report is invalid");
  return {
    id: parsed.data.id,
    organisationName: parsed.data.organisation_name,
    payload: parsed.data.payload,
    publishedAt: parsed.data.published_at,
    publisherName: one(parsed.data.publisher)?.display_name?.trim() || null,
  };
}
