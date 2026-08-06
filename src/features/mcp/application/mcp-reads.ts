import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readinessReportSchema } from "@/features/reports/application/leadership-snapshots";
import type { ReadinessReport } from "@/features/reports/domain/readiness-report";
import { DEFAULT_RISK_MATRIX_CONFIG, type RiskMatrixConfig } from "@/features/risks/domain/risks";
import type { SoaStatus } from "@/features/soa/domain/soa";
import { McpError } from "../auth/errors";
import {
  buildDailyDigestFacts,
  DIGEST_SEVERITIES,
  hashDailyDigestFacts,
  type DailyDigestFacts,
  type DigestMonitoringFinding,
  type DigestSeverity,
} from "../domain/digest";
import { safeSummary } from "../domain/safe-summary";
import { resolveWorkspace, type AccessibleWorkspace } from "./workspace-access";
import {
  buildAttentionItems,
  buildLiveReadiness,
  fetchAllPages,
  parseLocalDate,
  validateAttentionRequest,
  type AttentionItem,
  type AttentionSourceRows,
} from "./read-services";

const uuid = z.uuid();
const dateTime = z.string().datetime({ offset: true });
const soaStatus = z.enum(["pending", "absent", "in_progress", "established", "operational", "advanced", "not_applicable"]);
const riskConfigRow = z.object({ low_max: z.number().int(), moderate_max: z.number().int(), high_max: z.number().int(), appetite_threshold: z.number().int().nullable() });
const snapshotRow = z.object({ id: uuid, payload: readinessReportSchema, published_at: dateTime });
const monitoringStatus = z.enum(["open", "acknowledged", "resolved"]);
const monitoringRow = z.object({
  id: uuid,
  control_ref: z.string(),
  severity: z.enum(DIGEST_SEVERITIES),
  title: z.string(),
  status: monitoringStatus,
  task_id: z.string().nullable(),
  detected_at: dateTime,
  resolved_at: dateTime.nullable(),
});

type Snapshot = z.infer<typeof snapshotRow>;

function londonDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return parseLocalDate(`${values.year}-${values.month}-${values.day}`);
}

function queryFailure(): never { throw new McpError("INTERNAL_ERROR"); }

async function latestSnapshot(supabase: SupabaseClient, organisationId: string): Promise<Snapshot | null> {
  const { data, error } = await supabase
    .from("leadership_report_snapshots")
    .select("id,payload,published_at")
    .eq("organisation_id", organisationId)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) queryFailure();
  if (!data) return null;
  const parsed = snapshotRow.safeParse(data);
  if (!parsed.success) queryFailure();
  return parsed.data;
}

async function exactCount(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const result = await query;
  if (result.error || !Number.isSafeInteger(result.count) || (result.count ?? -1) < 0) queryFailure();
  return result.count!;
}

async function loadLiveOverview(supabase: SupabaseClient, organisationId: string, localDate: string): Promise<ReadinessReport> {
  const registerResult = await supabase.from("soa_registers").select("id").eq("organisation_id", organisationId)
    .order("version", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
  if (registerResult.error) queryFailure();
  const registerId = registerResult.data ? z.object({ id: uuid }).safeParse(registerResult.data) : null;
  if (registerId && !registerId.success) queryFailure();

  const soaPromise = registerId?.success
    ? fetchAllPages((from, to) => supabase.from("soa_items").select("id,status").eq("organisation_id", organisationId)
      .eq("soa_register_id", registerId.data.id).order("id", { ascending: true }).range(from, to))
    : Promise.resolve([]);
  const risksPromise = fetchAllPages((from, to) => supabase.from("risks")
    .select("id,status,residual_likelihood,residual_impact").eq("organisation_id", organisationId)
    .neq("status", "closed").order("id", { ascending: true }).range(from, to));
  const evidencePromise = fetchAllPages((from, to) => supabase.from("evidence")
    .select("id,status,valid_until").eq("organisation_id", organisationId)
    .order("id", { ascending: true }).range(from, to));
  const openTasks = exactCount(supabase.from("tasks").select("id", { count: "exact", head: true })
    .eq("organisation_id", organisationId).in("status", ["open", "in_progress"]));
  const overdueTasks = exactCount(supabase.from("tasks").select("id", { count: "exact", head: true })
    .eq("organisation_id", organisationId).in("status", ["open", "in_progress"]).not("due_on", "is", null).lt("due_on", localDate));
  const openAudits = exactCount(supabase.from("audits").select("id", { count: "exact", head: true })
    .eq("organisation_id", organisationId).neq("status", "closed"));
  const openNonConformities = exactCount(supabase.from("audit_findings").select("id", { count: "exact", head: true })
    .eq("organisation_id", organisationId).neq("status", "closed").neq("severity", "observation"));
  const configPromise = supabase.from("risk_matrix_config").select("low_max,moderate_max,high_max,appetite_threshold")
    .eq("organisation_id", organisationId).maybeSingle();

  const [soaRaw, risksRaw, evidenceRaw, taskOpenCount, taskOverdueCount, auditCount, findingCount, configResult] = await Promise.all([
    soaPromise, risksPromise, evidencePromise, openTasks, overdueTasks, openAudits, openNonConformities, configPromise,
  ]);
  if (configResult.error) queryFailure();
  const soa = z.array(z.object({ id: uuid, status: soaStatus })).safeParse(soaRaw);
  const risks = z.array(z.object({ id: uuid, status: z.string(), residual_likelihood: z.number().int().min(1).max(5), residual_impact: z.number().int().min(1).max(5) })).safeParse(risksRaw);
  const evidence = z.array(z.object({ id: uuid, status: z.enum(["current", "expiring", "expired", "superseded", "withdrawn"]), valid_until: z.string().nullable() })).safeParse(evidenceRaw);
  const configParsed = configResult.data ? riskConfigRow.safeParse(configResult.data) : null;
  if (!soa.success || !risks.success || !evidence.success || (configParsed && !configParsed.success)) queryFailure();
  const config: RiskMatrixConfig = configParsed?.success ? {
    lowMax: configParsed.data.low_max,
    moderateMax: configParsed.data.moderate_max,
    highMax: configParsed.data.high_max,
    appetite: configParsed.data.appetite_threshold,
  } : DEFAULT_RISK_MATRIX_CONFIG;
  return buildLiveReadiness({
    soa: soa.data.map(({ status }) => ({ status: status as SoaStatus })),
    risks: risks.data,
    evidence: evidence.data,
    tasks: { open: taskOpenCount, overdue: taskOverdueCount },
    openAudits: auditCount,
    openNonConformities: findingCount,
    config,
    localDate,
  });
}

async function overviewForWorkspace(supabase: SupabaseClient, workspace: AccessibleWorkspace, localDate: string) {
  const report = await latestSnapshot(supabase, workspace.id);
  if (workspace.role === "member") {
    if (!report) throw new McpError("NOT_FOUND");
    return { workspace: { id: workspace.id, name: workspace.name }, source: "published" as const, readiness: report.payload, latestReport: { id: report.id, publishedAt: report.published_at } };
  }
  const readiness = await loadLiveOverview(supabase, workspace.id, localDate);
  return { workspace: { id: workspace.id, name: workspace.name }, source: "live" as const, readiness, latestReport: report ? { id: report.id, publishedAt: report.published_at } : null };
}

export async function getComplianceOverview(
  supabase: SupabaseClient,
  verifiedUserId: string,
  input: { workspaceId?: string; localDate?: string },
) {
  const workspace = await resolveWorkspace(supabase, verifiedUserId, input.workspaceId);
  return overviewForWorkspace(supabase, workspace, parseLocalDate(input.localDate ?? londonDate()));
}

async function loadAttentionRows(supabase: SupabaseClient, organisationId: string, localDate: string, fetchLimit = 51): Promise<AttentionSourceRows> {
  const expiryThrough = new Date(`${localDate}T00:00:00Z`);
  expiryThrough.setUTCDate(expiryThrough.getUTCDate() + 30);
  const expiryDate = expiryThrough.toISOString().slice(0, 10);
  const [tasks, evidence, policies, risks, findings] = await Promise.all([
    supabase.from("tasks").select("id,title,due_on,status").eq("organisation_id", organisationId).in("status", ["open", "in_progress"])
      .not("due_on", "is", null).lt("due_on", localDate).order("due_on", { ascending: true }).order("id", { ascending: true }).limit(fetchLimit),
    supabase.from("evidence").select("id,title,valid_until,status").eq("organisation_id", organisationId)
      .not("status", "in", "(superseded,withdrawn)").not("valid_until", "is", null).lte("valid_until", expiryDate)
      .order("valid_until", { ascending: true }).order("id", { ascending: true }).limit(fetchLimit),
    supabase.from("policies").select("id,reference,title,review_due,status").eq("organisation_id", organisationId).eq("status", "approved")
      .not("review_due", "is", null).lte("review_due", localDate).order("review_due", { ascending: true }).order("id", { ascending: true }).limit(fetchLimit),
    fetchAllPages((from, to) => supabase.from("risks").select("id,reference,title,review_date,status,residual_likelihood,residual_impact")
      .eq("organisation_id", organisationId).neq("status", "closed").order("id", { ascending: true }).range(from, to)),
    supabase.from("audit_findings").select("id,summary,severity,status,created_at").eq("organisation_id", organisationId).neq("status", "closed")
      .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(fetchLimit),
  ]);
  if ([tasks, evidence, policies, findings].some((result) => result.error)) queryFailure();
  const schema = z.object({
    tasks: z.array(z.object({ id: uuid, title: z.string(), due_on: z.string().nullable(), status: z.string() })),
    evidence: z.array(z.object({ id: uuid, title: z.string(), valid_until: z.string().nullable(), status: z.enum(["current", "expiring", "expired", "superseded", "withdrawn"]) })),
    policies: z.array(z.object({ id: uuid, reference: z.string(), title: z.string(), review_due: z.string().nullable(), status: z.string() })),
    risks: z.array(z.object({ id: uuid, reference: z.string(), title: z.string(), review_date: z.string().nullable(), status: z.string(), residual_likelihood: z.number().int(), residual_impact: z.number().int() })),
    findings: z.array(z.object({ id: uuid, summary: z.string(), severity: z.string(), status: z.string(), created_at: dateTime })),
  }).safeParse({ tasks: tasks.data, evidence: evidence.data, policies: policies.data, risks, findings: findings.data });
  if (!schema.success) queryFailure();
  return schema.data;
}

async function loadRiskConfig(supabase: SupabaseClient, organisationId: string): Promise<RiskMatrixConfig> {
  const result = await supabase.from("risk_matrix_config").select("low_max,moderate_max,high_max,appetite_threshold").eq("organisation_id", organisationId).maybeSingle();
  if (result.error) queryFailure();
  if (!result.data) return DEFAULT_RISK_MATRIX_CONFIG;
  const parsed = riskConfigRow.safeParse(result.data);
  if (!parsed.success) queryFailure();
  return { lowMax: parsed.data.low_max, moderateMax: parsed.data.moderate_max, highMax: parsed.data.high_max, appetite: parsed.data.appetite_threshold };
}

async function attentionForWorkspace(supabase: SupabaseClient, workspace: AccessibleWorkspace, input: { localDate: string; categories?: string[]; severity?: string; limit?: number }) {
  const validated = validateAttentionRequest(input);
  const config = await loadRiskConfig(supabase, workspace.id);
  const rows = await loadAttentionRows(supabase, workspace.id, validated.localDate, validated.limit + 1);
  const items = buildAttentionItems(rows, { ...validated, categories: validated.categories, config });
  const limit = validated.limit;
  return { workspace: { id: workspace.id, name: workspace.name }, items: items.slice(0, limit), truncated: items.length > limit };
}

export async function listAttentionItems(supabase: SupabaseClient, verifiedUserId: string, input: { workspaceId?: string; categories?: string[]; severity?: string; limit?: number; localDate?: string }) {
  const workspace = await resolveWorkspace(supabase, verifiedUserId, input.workspaceId);
  return attentionForWorkspace(supabase, workspace, { ...input, localDate: parseLocalDate(input.localDate ?? londonDate()) });
}

async function monitoringForWorkspace(supabase: SupabaseClient, workspace: AccessibleWorkspace, input: { status?: string; severity?: string; limit?: number }) {
  const limit = z.number().int().min(1).max(50).safeParse(input.limit ?? 20);
  const severity = input.severity === undefined ? null : z.enum(DIGEST_SEVERITIES).safeParse(input.severity);
  const status = input.status === undefined ? null : monitoringStatus.safeParse(input.status);
  if (!limit.success || (severity && !severity.success) || (status && !status.success)) throw new McpError("VALIDATION_ERROR");
  let query = supabase.from("monitoring_findings").select("id,control_ref,severity,title,status,task_id,detected_at,resolved_at")
    .eq("organisation_id", workspace.id);
  query = status?.success ? query.eq("status", status.data) : query.in("status", ["open", "acknowledged"]);
  if (severity?.success) query = query.eq("severity", severity.data);
  const result = await query.order("severity", { ascending: false }).order("detected_at", { ascending: false }).order("id", { ascending: true }).limit(limit.data + 1);
  if (result.error) queryFailure();
  const parsed = z.array(monitoringRow).safeParse(result.data);
  if (!parsed.success) queryFailure();
  const findings = parsed.data.map((row) => ({
    id: row.id,
    severity: row.severity,
    status: row.status,
    title: safeSummary(row.title, 240, "Monitoring finding"),
    ...(row.control_ref.trim() ? { controlRef: safeSummary(row.control_ref, 80) } : {}),
    detectedAt: new Date(row.detected_at).toISOString(),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
    hasRemediationTask: row.task_id !== null,
  })).sort((left, right) => {
    const ranks: Record<DigestSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };
    return ranks[right.severity] - ranks[left.severity]
      || right.detectedAt.localeCompare(left.detectedAt)
      || left.id.localeCompare(right.id);
  });
  return { workspace: { id: workspace.id, name: workspace.name }, findings: findings.slice(0, limit.data), truncated: findings.length > limit.data };
}

export async function listMonitoringFindings(supabase: SupabaseClient, verifiedUserId: string, input: { workspaceId?: string; status?: string; severity?: string; limit?: number }) {
  const workspace = await resolveWorkspace(supabase, verifiedUserId, input.workspaceId);
  return monitoringForWorkspace(supabase, workspace, input);
}

export async function getLatestLeadershipReport(supabase: SupabaseClient, verifiedUserId: string, input: { workspaceId?: string }) {
  const workspace = await resolveWorkspace(supabase, verifiedUserId, input.workspaceId);
  const report = await latestSnapshot(supabase, workspace.id);
  return { workspace: { id: workspace.id, name: workspace.name }, report: report ? { id: report.id, payload: report.payload, publishedAt: report.published_at } : null };
}

const deliveryRow = z.object({ id: uuid, status: z.enum(["reserved", "delivered", "failed", "unknown"]), delivered_at: dateTime.nullable() });
export type PrepareDailyDigestResult = {
  status: "ready" | "already_delivered" | "delivery_failed" | "delivery_unknown" | "delivery_reserved";
  facts: DailyDigestFacts;
  factHash: string;
  delivery: { id: string; deliveredAt: string | null } | null;
};

export function mapDeliveryStatus(status: "reserved" | "delivered" | "failed" | "unknown" | null): PrepareDailyDigestResult["status"] {
  if (status === "delivered") return "already_delivered";
  if (status === "failed") return "delivery_failed";
  if (status === "unknown") return "delivery_unknown";
  if (status === "reserved") return "delivery_reserved";
  return "ready";
}

export async function prepareDailyDigest(supabase: SupabaseClient, verifiedUserId: string, input: { workspaceId?: string; localDate: string }): Promise<PrepareDailyDigestResult> {
  const localDate = parseLocalDate(input.localDate);
  const workspace = await resolveWorkspace(supabase, verifiedUserId, input.workspaceId);
  const [overview, attention, monitoring, report] = await Promise.all([
    overviewForWorkspace(supabase, workspace, localDate),
    attentionForWorkspace(supabase, workspace, { localDate, limit: 20 }),
    monitoringForWorkspace(supabase, workspace, { limit: 20 }),
    latestSnapshot(supabase, workspace.id),
  ]);
  let delivery: z.infer<typeof deliveryRow> | null = null;
  if (workspace.role === "owner") {
    const result = await supabase.from("daily_digest_deliveries").select("id,status,delivered_at")
      .eq("organisation_id", workspace.id).eq("digest_on", localDate).maybeSingle();
    if (result.error) queryFailure();
    if (result.data) {
      const parsed = deliveryRow.safeParse(result.data);
      if (!parsed.success) queryFailure();
      delivery = parsed.data;
    }
  }
  const attentionWithOverflow: AttentionItem[] = attention.items.concat(attention.truncated ? [{ id: "truncation-marker", category: "overdue_task", severity: "low", summary: "Additional attention items were omitted", source: "system" }] : []);
  const monitoringWithOverflow: DigestMonitoringFinding[] = monitoring.findings.map(({ id, severity, status, title, controlRef, detectedAt }) => ({ id, severity: severity as DigestSeverity, status, title, ...(controlRef ? { controlRef } : {}), detectedAt }));
  if (monitoring.truncated) monitoringWithOverflow.push({ id: "truncation-marker", severity: "low", status: "omitted", title: "Additional monitoring findings were omitted", detectedAt: `${localDate}T00:00:00.000Z` });
  const facts = buildDailyDigestFacts({
    workspace: { id: workspace.id, name: workspace.name },
    localDate,
    overview: overview.readiness,
    attentionItems: attentionWithOverflow,
    monitoringFindings: monitoringWithOverflow,
    latestLeadershipReport: report ? { id: report.id, publishedAt: report.published_at } : null,
  });
  const status = mapDeliveryStatus(delivery?.status ?? null);
  return { status, facts, factHash: hashDailyDigestFacts(facts), delivery: delivery ? { id: delivery.id, deliveredAt: delivery.delivered_at } : null };
}
