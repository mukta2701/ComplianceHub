import { createHash } from "node:crypto";
import { z } from "zod";
import type { ReadinessReport } from "@/features/reports/domain/readiness-report";

export const DIGEST_ATTENTION_CATEGORIES = [
  "overdue_task",
  "stale_evidence",
  "policy_review",
  "high_risk",
  "unresolved_finding",
] as const;

export const DIGEST_SEVERITIES = ["low", "medium", "high", "critical"] as const;

const unsafeTextPattern = /(?:https?:\/\/|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\bbearer\s+\S+|\btoken\s*=|[\r\n]|[<>])/i;

const digestText = (max: number) => z.string()
  .trim()
  .min(1)
  .max(max)
  .refine((value) => !unsafeTextPattern.test(value), "Digest text contains sensitive or unsupported formatting");

const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day;
}, "localDate must be a real calendar date");

const overviewSchema: z.ZodType<ReadinessReport> = z.object({
  soaPercent: z.number().int().min(0).max(100),
  soaTotal: z.number().int().nonnegative(),
  riskBands: z.object({
    low: z.number().int().nonnegative(),
    moderate: z.number().int().nonnegative(),
    high: z.number().int().nonnegative(),
    very_high: z.number().int().nonnegative(),
  }),
  tasksOpen: z.number().int().nonnegative(),
  tasksOverdue: z.number().int().nonnegative(),
  evidence: z.object({
    total: z.number().int().nonnegative(),
    expiring: z.number().int().nonnegative(),
    expired: z.number().int().nonnegative(),
  }),
  openAudits: z.number().int().nonnegative(),
  openNonConformities: z.number().int().nonnegative(),
});

export const dailyDigestMessageSchema = z.object({
  headline: digestText(120),
  priorities: z.array(digestText(240)).max(5),
  actions: z.array(digestText(240)).max(5),
}).strict();

export type DailyDigestMessage = z.infer<typeof dailyDigestMessageSchema>;
export type DigestSeverity = typeof DIGEST_SEVERITIES[number];
export type DigestAttentionCategory = typeof DIGEST_ATTENTION_CATEGORIES[number];

export type DigestAttentionItem = {
  id: string;
  category: DigestAttentionCategory;
  severity: DigestSeverity;
  summary: string;
  dueOn?: string;
  observedOn?: string;
  source: "task" | "evidence" | "policy" | "risk" | "audit_finding" | "system";
};

export type DigestMonitoringFinding = {
  id: string;
  severity: DigestSeverity;
  status: string;
  title: string;
  controlRef?: string;
  detectedAt: string;
};

export type DailyDigestFacts = {
  schemaVersion: 1;
  workspace: { id: string; name: string };
  localDate: string;
  overview: ReadinessReport;
  attentionItems: DigestAttentionItem[];
  monitoringFindings: DigestMonitoringFinding[];
  latestLeadershipReport: { id: string; publishedAt: string } | null;
  truncation: { attentionItems: boolean; monitoringFindings: boolean };
};

type BuildDailyDigestFactsInput = {
  workspace: { id: string; name: string };
  localDate: string;
  overview: ReadinessReport;
  attentionItems: readonly DigestAttentionItem[];
  monitoringFindings: readonly DigestMonitoringFinding[];
  latestLeadershipReport: { id: string; publishedAt: string } | null;
  limits?: { attentionItems?: number; monitoringFindings?: number };
};

const severityRank: Record<DigestSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };
const categoryRank: Record<DigestAttentionCategory, number> = { overdue_task: 1, stale_evidence: 2, policy_review: 3, high_risk: 4, unresolved_finding: 5 };

function cleanFactText(value: string, max: number): string {
  return digestText(max).parse(value.replace(/\s+/g, " ").trim());
}

function cleanId(value: string): string {
  return z.string().trim().min(1).max(200).parse(value);
}

function normaliseDateTime(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid digest fact timestamp");
  return parsed.toISOString();
}

function boundedLimit(value: number | undefined, fallback: number): number {
  return z.number().int().min(1).max(50).parse(value ?? fallback);
}

export function buildDailyDigestFacts(input: BuildDailyDigestFactsInput): DailyDigestFacts {
  const localDate = localDateSchema.parse(input.localDate);
  const attentionLimit = boundedLimit(input.limits?.attentionItems, 20);
  const monitoringLimit = boundedLimit(input.limits?.monitoringFindings, 20);
  const attentionItems = input.attentionItems.map((item) => {
    const source = z.enum(["task", "evidence", "policy", "risk", "audit_finding", "system"]).parse(item.source);
    const id = cleanId(item.id);
    if (!id.startsWith(`${source}:`)) throw new Error("Digest attention ID must be source-prefixed");
    return {
      id, source,
      category: z.enum(DIGEST_ATTENTION_CATEGORIES).parse(item.category),
      severity: z.enum(DIGEST_SEVERITIES).parse(item.severity),
      summary: cleanFactText(item.summary, 240),
      ...(item.dueOn ? { dueOn: localDateSchema.parse(item.dueOn) } : {}),
      ...(item.observedOn ? { observedOn: normaliseDateTime(item.observedOn) } : {}),
    };
  }).sort((left, right) => severityRank[right.severity] - severityRank[left.severity]
    || (left.dueOn ?? left.observedOn ?? "9999-12-31").localeCompare(right.dueOn ?? right.observedOn ?? "9999-12-31")
    || categoryRank[left.category] - categoryRank[right.category]
    || left.source.localeCompare(right.source)
    || left.id.localeCompare(right.id));
  const monitoringFindings = input.monitoringFindings.map((finding) => ({
    id: z.string().refine((id) => id.startsWith("monitoring_finding:"), "Monitoring ID must be source-prefixed").parse(cleanId(finding.id)),
    severity: z.enum(DIGEST_SEVERITIES).parse(finding.severity),
    status: cleanFactText(finding.status, 40),
    title: cleanFactText(finding.title, 240),
    ...(finding.controlRef ? { controlRef: cleanFactText(finding.controlRef, 80) } : {}),
    detectedAt: normaliseDateTime(finding.detectedAt),
  })).sort((left, right) => severityRank[right.severity] - severityRank[left.severity]
    || right.detectedAt.localeCompare(left.detectedAt)
    || left.id.localeCompare(right.id));

  return {
    schemaVersion: 1,
    workspace: {
      id: z.string().uuid().parse(input.workspace.id),
      name: cleanFactText(input.workspace.name, 160),
    },
    localDate,
    overview: overviewSchema.parse(input.overview),
    attentionItems: attentionItems.slice(0, attentionLimit),
    monitoringFindings: monitoringFindings.slice(0, monitoringLimit),
    latestLeadershipReport: input.latestLeadershipReport ? {
      id: cleanId(input.latestLeadershipReport.id),
      publishedAt: normaliseDateTime(input.latestLeadershipReport.publishedAt),
    } : null,
    truncation: {
      attentionItems: attentionItems.length > attentionLimit,
      monitoringFindings: monitoringFindings.length > monitoringLimit,
    },
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export function hashDailyDigestFacts(facts: DailyDigestFacts): string {
  return createHash("sha256").update(canonicalJson(facts), "utf8").digest("hex");
}

function numbersInText(value: string): number[] {
  return [...value.matchAll(/\b\d+(?:\.\d+)?\b/g)].map((match) => Number(match[0]));
}

function allowedFactNumbers(facts: DailyDigestFacts): Set<number> {
  const allowed = new Set<number>();
  const addText = (value: string | undefined) => {
    if (value) for (const number of numbersInText(value)) allowed.add(number);
  };
  const addOverview = (value: unknown) => {
    if (typeof value === "number") allowed.add(value);
    else if (value && typeof value === "object") {
      for (const nested of Object.values(value as Record<string, unknown>)) addOverview(nested);
    }
  };
  addOverview(facts.overview);
  addText(facts.workspace.name);
  addText(facts.localDate);
  for (const item of facts.attentionItems) {
    addText(item.summary);
    addText(item.dueOn);
    addText(item.observedOn);
  }
  for (const finding of facts.monitoringFindings) {
    addText(finding.title);
    addText(finding.controlRef);
    addText(finding.detectedAt);
  }
  addText(facts.latestLeadershipReport?.publishedAt);
  return allowed;
}

export function validateDigestMessageAgainstFacts(
  message: DailyDigestMessage,
  facts: DailyDigestFacts,
): { ok: true } | { ok: false; unsupportedNumbers: number[] } {
  const parsed = dailyDigestMessageSchema.parse(message);
  const allowed = allowedFactNumbers(facts);
  const unsupportedNumbers = [...new Set([
    parsed.headline,
    ...parsed.priorities,
    ...parsed.actions,
  ].flatMap(numbersInText).filter((number) => !allowed.has(number)))].sort((a, b) => a - b);
  return unsupportedNumbers.length > 0 ? { ok: false, unsupportedNumbers } : { ok: true };
}

function escapeSlack(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function buildSlackDigestPayload(
  message: DailyDigestMessage,
  context: { workspaceName: string; localDate: string },
) {
  const parsed = dailyDigestMessageSchema.parse(message);
  const workspaceName = cleanFactText(context.workspaceName, 160);
  const localDate = localDateSchema.parse(context.localDate);
  const bulletList = (items: string[]) => items.length > 0
    ? items.map((item) => `• ${escapeSlack(item)}`).join("\n")
    : "• None reported in the prepared facts";

  return {
    text: `ComplianceHub daily brief — ${workspaceName} — ${localDate}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "ComplianceHub daily brief" } },
      { type: "section", text: { type: "mrkdwn", text: `*${escapeSlack(parsed.headline)}*\n${escapeSlack(workspaceName)} · ${localDate}` } },
      { type: "section", text: { type: "mrkdwn", text: `*Priorities*\n${bulletList(parsed.priorities)}` } },
      { type: "section", text: { type: "mrkdwn", text: `*Actions*\n${bulletList(parsed.actions)}` } },
    ],
  } as const;
}
