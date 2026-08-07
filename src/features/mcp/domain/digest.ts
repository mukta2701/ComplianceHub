import { createHash } from "node:crypto";
import { z } from "zod";
import type { ReadinessReport } from "@/features/reports/domain/readiness-report";
import { containsSensitiveCredential } from "./safe-summary";

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
  .refine((value) => !unsafeTextPattern.test(value) && !containsSensitiveCredential(value), "Digest text contains sensitive or unsupported formatting");

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
}).superRefine((value, context) => {
  if (value.tasksOverdue > value.tasksOpen) {
    context.addIssue({ code: "custom", path: ["tasksOverdue"], message: "Overdue tasks cannot exceed open tasks" });
  }
  if (value.evidence.expiring + value.evidence.expired > value.evidence.total) {
    context.addIssue({ code: "custom", path: ["evidence"], message: "Stale evidence cannot exceed total evidence" });
  }
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

function londonCalendarDate(value: string): string {
  const timestamp = normaliseDateTime(value);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", calendar: "gregory", numberingSystem: "latn",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export function compareDigestAttentionItems(left: DigestAttentionItem, right: DigestAttentionItem): number {
  const priorityDate = (item: DigestAttentionItem) => item.dueOn
    ?? (item.observedOn ? londonCalendarDate(item.observedOn) : "9999-12-31");
  return severityRank[right.severity] - severityRank[left.severity]
    || priorityDate(left).localeCompare(priorityDate(right))
    || categoryRank[left.category] - categoryRank[right.category]
    || left.source.localeCompare(right.source)
    || left.id.localeCompare(right.id);
}

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
  }).sort(compareDigestAttentionItems);
  if (new Set(attentionItems.map(({ id }) => id)).size !== attentionItems.length) {
    throw new Error("Duplicate attention item ID");
  }
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
  if (new Set(monitoringFindings.map(({ id }) => id)).size !== monitoringFindings.length) {
    throw new Error("Duplicate monitoring finding ID");
  }

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

type NumberClaim = { value: number; start: number; end: number };

function numberClaims(value: string): NumberClaim[] {
  return [...value.matchAll(/\b\d+(?:\.\d+)?\b/g)].map((match) => ({
    value: Number(match[0]),
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exactFactLiterals(facts: DailyDigestFacts): string[] {
  return [
    facts.workspace.name,
    facts.localDate,
    ...facts.attentionItems.flatMap((item) => [item.id, item.summary, item.dueOn, item.observedOn]),
    ...facts.monitoringFindings.flatMap((finding) => [finding.id, finding.title, finding.controlRef, finding.detectedAt]),
    facts.latestLeadershipReport?.id,
    facts.latestLeadershipReport?.publishedAt,
  ].filter((value): value is string => Boolean(value));
}

function literalNumberRanges(text: string, facts: DailyDigestFacts): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const literal of exactFactLiterals(facts)) {
    const matcher = new RegExp(escapeRegExp(literal), "gi");
    for (const match of text.matchAll(matcher)) {
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }
  return ranges;
}

type MetricRule = { label: string; expected: number; suffix?: string };

function metricRules(facts: DailyDigestFacts): MetricRule[] {
  return [
    { label: "(?:soa\\s+)?(?:readiness|ready)", expected: facts.overview.soaPercent, suffix: "(?:%|percent)?" },
    { label: "(?:soa\\s+)?(?:controls?|items?)", expected: facts.overview.soaTotal },
    { label: "open\\s+tasks?", expected: facts.overview.tasksOpen },
    { label: "overdue\\s+tasks?", expected: facts.overview.tasksOverdue },
    { label: "(?:evidence\\s+items?|total\\s+evidence)", expected: facts.overview.evidence.total },
    { label: "expiring\\s+evidence", expected: facts.overview.evidence.expiring },
    { label: "expired\\s+evidence", expected: facts.overview.evidence.expired },
    { label: "very[- ]high\\s+risks?", expected: facts.overview.riskBands.very_high },
    { label: "high\\s+risks?", expected: facts.overview.riskBands.high },
    { label: "moderate\\s+risks?", expected: facts.overview.riskBands.moderate },
    { label: "low\\s+risks?", expected: facts.overview.riskBands.low },
    { label: "open\\s+audits?", expected: facts.overview.openAudits },
    { label: "open\\s+non[- ]?conformit(?:y|ies)", expected: facts.overview.openNonConformities },
  ];
}

function metricClaimSupport(text: string, facts: DailyDigestFacts): Map<number, boolean> {
  const support = new Map<number, boolean>();
  for (const rule of metricRules(facts)) {
    const number = "(?<number>\\d+(?:\\.\\d+)?)";
    const patterns = [
      new RegExp(`${number}\\s*${rule.suffix ?? ""}\\s*${rule.label}\\b`, "gi"),
      new RegExp(`\\b${rule.label}\\s*(?:is|are|:|-)?\\s*${number}${rule.suffix ?? ""}`, "gi"),
    ];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const raw = match.groups?.number;
        if (!raw || match.index === undefined) continue;
        const relative = match[0].indexOf(raw);
        const start = match.index + relative;
        const current = support.get(start);
        const valid = Number(raw) === rule.expected;
        support.set(start, current === undefined ? valid : current && valid);
      }
    }
  }
  return support;
}

function isSupportedMetricLine(text: string, facts: DailyDigestFacts): boolean {
  const clauses = text.split(/\s+(?:and|&)\s+/i);
  if (clauses.length === 0) return false;
  const action = "(?:review|address|resolve|investigate|prioriti[sz]e)\\s+";
  return clauses.every((clause) => metricRules(facts).some((rule) => {
    const expected = escapeRegExp(String(rule.expected));
    const suffix = rule.suffix ?? "";
    const patterns = [
      new RegExp(`^(?:${action})?${expected}\\s*${suffix}\\s*${rule.label}$`, "i"),
      new RegExp(`^${rule.label}\\s*(?:is|are|:|-)\\s*${expected}${suffix}$`, "i"),
    ];
    return patterns.some((pattern) => pattern.test(clause));
  }));
}

export function validateDigestMessageAgainstFacts(
  message: DailyDigestMessage,
  facts: DailyDigestFacts,
): { ok: true } | { ok: false; unsupportedNumbers: number[] } {
  const parsed = dailyDigestMessageSchema.parse(message);
  const lines = [
    parsed.headline,
    ...parsed.priorities,
    ...parsed.actions,
  ];
  const literals = new Set(exactFactLiterals(facts));
  const unsupportedLines = lines.filter((text) => !literals.has(text) && !isSupportedMetricLine(text, facts));
  const unsupportedNumbers = [...new Set(unsupportedLines.flatMap((text) => {
    const literalRanges = literalNumberRanges(text, facts);
    const metricSupport = metricClaimSupport(text, facts);
    return numberClaims(text).filter((claim) => {
      const metric = metricSupport.get(claim.start);
      if (metric !== undefined) return !metric;
      return !literalRanges.some((range) => claim.start >= range.start && claim.end <= range.end);
    }).map(({ value }) => value);
  }))].sort((a, b) => a - b);
  return unsupportedLines.length > 0 ? { ok: false, unsupportedNumbers } : { ok: true };
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
  const bulletList = (items: string[]) => items.map((item) => `• ${escapeSlack(item)}`).join("\n");
  const section = (heading: string, items: string[]) => {
    const bullets = bulletList(items);
    return bullets ? `*${heading}*\n${bullets}` : `*${heading}*`;
  };

  return {
    text: `ComplianceHub daily brief — ${workspaceName} — ${localDate}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "ComplianceHub daily brief" } },
      { type: "section", text: { type: "mrkdwn", text: `*${escapeSlack(parsed.headline)}*\n${escapeSlack(workspaceName)} · ${localDate}` } },
      { type: "section", text: { type: "mrkdwn", text: section("Priorities", parsed.priorities) } },
      { type: "section", text: { type: "mrkdwn", text: section("Actions", parsed.actions) } },
    ],
  } as const;
}
