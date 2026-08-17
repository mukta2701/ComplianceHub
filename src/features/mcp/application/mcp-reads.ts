import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readinessReportSchema } from "@/features/reports/application/leadership-snapshots";
import { DEFAULT_RISK_MATRIX_CONFIG, type RiskMatrixConfig } from "@/features/risks/domain/risks";
import { McpError } from "../auth/errors";
import {
  buildDailyDigestFacts,
  DIGEST_SEVERITIES,
  hashDailyDigestFacts,
  type DailyDigestFacts,
  type DigestSeverity,
} from "../domain/digest";
import { safeSummary } from "../domain/safe-summary";
import { resolveWorkspace, type AccessibleWorkspace } from "./workspace-access";
import {
  buildAttentionItems,
  fetchAllPages,
  parseLocalDate,
  validateAttentionRequest,
  type AttentionSourceRows,
} from "./read-services";

const uuid = z.uuid();
const dateTime = z.string().datetime({ offset: true });
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
const bundleAttentionRow = z.object({
  id: z.string().min(1).max(200),
  source: z.enum(["task", "evidence", "policy", "risk", "audit_finding"]),
  category: z.enum(["overdue_task", "stale_evidence", "policy_review", "high_risk", "unresolved_finding"]),
  severity: z.enum(DIGEST_SEVERITIES),
  summary: z.string(),
  dueOn: z.string().optional(),
  observedOn: dateTime.optional(),
}).strict();
const bundleMonitoringRow = z.object({
  id: z.string().min(1).max(200),
  severity: z.enum(DIGEST_SEVERITIES),
  status: monitoringStatus,
  title: z.string(),
  controlRef: z.string().optional(),
  detectedAt: dateTime,
  resolvedAt: dateTime.nullable().optional(),
  hasRemediationTask: z.boolean(),
}).strict();
const bundleSchema = z.object({
  schemaVersion: z.literal(1),
  workspace: z.object({ id: uuid, name: z.string(), role: z.enum(["owner", "admin", "member"]) }).strict(),
  overviewSource: z.enum(["live", "published"]),
  overview: readinessReportSchema.nullable(),
  attentionItems: z.array(bundleAttentionRow).max(51),
  monitoringFindings: z.array(bundleMonitoringRow).max(51),
  latestLeadershipReport: z.object({ id: uuid, publishedAt: dateTime }).strict().nullable(),
  delivery: z.object({ id: uuid, status: z.enum(["reserved", "delivered", "failed", "unknown"]), deliveredAt: dateTime.nullable() }).strict().nullable(),
}).strict();

type ComplianceBundle = z.infer<typeof bundleSchema>;

type Snapshot = z.infer<typeof snapshotRow>;

// Supabase's hosted authenticated role defaults to an 8s statement timeout.
// Keep the user-scoped HTTP request shorter so callers regain control first.
export const MCP_BUNDLE_REQUEST_TIMEOUT_MS = 7_000;

export function dateInLondon(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return parseLocalDate(`${values.year}-${values.month}-${values.day}`);
}

function queryFailure(): never { throw new McpError("INTERNAL_ERROR"); }

async function loadComplianceBundle(
  supabase: SupabaseClient,
  workspace: AccessibleWorkspace,
  localDate: string,
): Promise<ComplianceBundle> {
  let response: { data: unknown; error: unknown };
  try {
    response = await supabase.rpc("get_mcp_compliance_bundle", {
      target_organisation_id: workspace.id,
      target_local_date: localDate,
      attention_limit: 20,
      monitoring_limit: 20,
    }).abortSignal(AbortSignal.timeout(MCP_BUNDLE_REQUEST_TIMEOUT_MS));
  } catch {
    queryFailure();
  }
  const { data, error } = response;
  if (error || !data) queryFailure();
  const parsed = bundleSchema.safeParse(data);
  if (!parsed.success
    || parsed.data.workspace.id !== workspace.id
    || parsed.data.workspace.role !== workspace.role
    || parsed.data.overviewSource !== (workspace.role === "member" ? "published" : "live")) queryFailure();
  return {
    ...parsed.data,
    workspace: { ...parsed.data.workspace, name: safeSummary(parsed.data.workspace.name, 160, "Workspace") },
    attentionItems: parsed.data.attentionItems.map((item) => ({ ...item, summary: safeSummary(item.summary, 240, "Attention item") })),
    monitoringFindings: parsed.data.monitoringFindings.map((finding) => ({
      ...finding,
      title: safeSummary(finding.title, 240, "Monitoring finding"),
      ...(finding.controlRef ? { controlRef: safeSummary(finding.controlRef, 80, "Control") } : {}),
    })),
  };
}

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

function publishedOverviewForMember(workspace: AccessibleWorkspace, report: Snapshot | null) {
  if (!report) throw new McpError("NOT_FOUND");
  return { workspace: { id: workspace.id, name: workspace.name }, source: "published" as const, readiness: report.payload, latestReport: { id: report.id, publishedAt: report.published_at } };
}

export async function getComplianceOverview(
  supabase: SupabaseClient,
  verifiedUserId: string,
  input: { workspaceId?: string; localDate?: string },
) {
  const workspace = await resolveWorkspace(supabase, verifiedUserId, input.workspaceId);
  const localDate = parseLocalDate(input.localDate ?? dateInLondon());
  if (workspace.role === "member") {
    const report = await latestSnapshot(supabase, workspace.id);
    return publishedOverviewForMember(workspace, report);
  }
  const bundle = await loadComplianceBundle(supabase, workspace, localDate);
  if (!bundle.overview) queryFailure();
  return {
    workspace: { id: bundle.workspace.id, name: bundle.workspace.name },
    source: bundle.overviewSource,
    readiness: bundle.overview,
    latestReport: bundle.latestLeadershipReport,
  };
}

async function loadAttentionRows(supabase: SupabaseClient, organisationId: string, localDate: string, categories: ReadonlySet<string>): Promise<AttentionSourceRows> {
  const expiryThrough = new Date(`${localDate}T00:00:00Z`);
  expiryThrough.setUTCDate(expiryThrough.getUTCDate() + 30);
  const expiryDate = expiryThrough.toISOString().slice(0, 10);
  const [tasks, evidence, policies, risks, findings] = await Promise.all([
    categories.has("overdue_task") ? fetchAllPages((from, to) => supabase.from("tasks").select("id,title,due_on,status").eq("organisation_id", organisationId).in("status", ["open", "in_progress"])
      .not("due_on", "is", null).lt("due_on", localDate).order("due_on", { ascending: true }).order("id", { ascending: true }).range(from, to)) : Promise.resolve([]),
    categories.has("stale_evidence") ? fetchAllPages((from, to) => supabase.from("evidence").select("id,title,valid_until,status").eq("organisation_id", organisationId)
      .not("status", "in", "(superseded,withdrawn)").not("valid_until", "is", null).lte("valid_until", expiryDate)
      .order("valid_until", { ascending: true }).order("id", { ascending: true }).range(from, to)) : Promise.resolve([]),
    categories.has("policy_review") ? fetchAllPages((from, to) => supabase.from("policies").select("id,reference,title,review_due,status").eq("organisation_id", organisationId).eq("status", "approved")
      .not("review_due", "is", null).lte("review_due", localDate).order("review_due", { ascending: true }).order("id", { ascending: true }).range(from, to)) : Promise.resolve([]),
    categories.has("high_risk") ? fetchAllPages((from, to) => supabase.from("risks").select("id,reference,title,review_date,status,residual_likelihood,residual_impact")
      .eq("organisation_id", organisationId).neq("status", "closed").order("id", { ascending: true }).range(from, to)) : Promise.resolve([]),
    categories.has("unresolved_finding") ? fetchAllPages((from, to) => supabase.from("audit_findings").select("id,severity,status,created_at,audit:audits!inner(reference)").eq("organisation_id", organisationId).neq("status", "closed")
      .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to)) : Promise.resolve([]),
  ]);
  const auditRelation = z.union([z.object({ reference: z.string() }), z.array(z.object({ reference: z.string() })).min(1).max(1).transform((items) => items[0]!) ]);
  const schema = z.object({
    tasks: z.array(z.object({ id: uuid, title: z.string(), due_on: z.string().nullable(), status: z.string() })),
    evidence: z.array(z.object({ id: uuid, title: z.string(), valid_until: z.string().nullable(), status: z.enum(["current", "expiring", "expired", "superseded", "withdrawn"]) })),
    policies: z.array(z.object({ id: uuid, reference: z.string(), title: z.string(), review_due: z.string().nullable(), status: z.string() })),
    risks: z.array(z.object({ id: uuid, reference: z.string(), title: z.string(), review_date: z.string().nullable(), status: z.string(), residual_likelihood: z.number().int(), residual_impact: z.number().int() })),
    findings: z.array(z.object({ id: uuid, severity: z.string(), status: z.string(), created_at: dateTime, audit: auditRelation })),
  }).safeParse({ tasks, evidence, policies, risks, findings });
  if (!schema.success) queryFailure();
  return { ...schema.data, findings: schema.data.findings.map(({ audit, ...row }) => ({ ...row, audit_reference: audit.reference })) };
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
  const categories = new Set(validated.categories ?? ["overdue_task", "stale_evidence", "policy_review", "high_risk", "unresolved_finding"]);
  if (categories.size === 0) return { workspace: { id: workspace.id, name: workspace.name }, items: [], truncated: false };
  const config = categories.has("high_risk") ? await loadRiskConfig(supabase, workspace.id) : DEFAULT_RISK_MATRIX_CONFIG;
  const rows = await loadAttentionRows(supabase, workspace.id, validated.localDate, categories);
  const items = buildAttentionItems(rows, { ...validated, categories: validated.categories, config });
  const limit = validated.limit;
  return { workspace: { id: workspace.id, name: workspace.name }, items: items.slice(0, limit), truncated: items.length > limit };
}

export async function listAttentionItems(supabase: SupabaseClient, verifiedUserId: string, input: { workspaceId?: string; categories?: string[]; severity?: string; limit?: number; localDate?: string }) {
  const workspace = await resolveWorkspace(supabase, verifiedUserId, input.workspaceId);
  return attentionForWorkspace(supabase, workspace, { ...input, localDate: parseLocalDate(input.localDate ?? dateInLondon()) });
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
    id: `monitoring_finding:${row.id}`,
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
  const bundle = await loadComplianceBundle(supabase, workspace, localDate);
  if (!bundle.overview) throw new McpError("NOT_FOUND");
  const facts = buildDailyDigestFacts({
    workspace: { id: bundle.workspace.id, name: bundle.workspace.name },
    localDate,
    overview: bundle.overview,
    attentionItems: bundle.attentionItems,
    monitoringFindings: bundle.monitoringFindings,
    latestLeadershipReport: bundle.latestLeadershipReport,
  });
  const status = mapDeliveryStatus(bundle.delivery?.status ?? null);
  return {
    status,
    facts,
    factHash: hashDailyDigestFacts(facts),
    delivery: bundle.delivery ? { id: bundle.delivery.id, deliveredAt: bundle.delivery.deliveredAt } : null,
  };
}
