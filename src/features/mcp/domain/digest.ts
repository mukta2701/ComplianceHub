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

export const DIGEST_GITHUB_CHANGE_KINDS = [
  "new_failure", "reopen", "resolution", "superseding_pass",
] as const;

export type DigestGitHubPartition = {
  activeCurrentPass: number;
  activeCurrentFail: number;
  activeCurrentUnknown: number;
  activeCurrentNotApplicable: number;
  activeStale: number;
  historical: number;
  total: number;
};

export type DigestGitHubResultFact = {
  id: string;
  repositoryId: string;
  repositoryLabel: string;
  checkId: string;
  result: "pass" | "fail" | "unknown" | "not_applicable";
  severity: DigestSeverity | null;
  summary: string;
  observedAt: string;
  freshUntil: string;
  materialisedAt: string;
};

export type DigestGitHubChangeFact = DigestGitHubResultFact & {
  id: string;
  resultId: string;
  kind: typeof DIGEST_GITHUB_CHANGE_KINDS[number];
  occurredAt: string;
};

export type DigestGitHubFactsInput = {
  partition: DigestGitHubPartition;
  baseline: { deliveredAt: string; localDate: string } | null;
  changes: {
    counts: { newFailure: number; reopen: number; resolution: number; supersedingPass: number; total: number };
    items: readonly DigestGitHubChangeFact[];
    truncated: boolean;
  };
  unknowns: { count: number; items: readonly DigestGitHubResultFact[]; truncated: boolean };
  staleResults: { count: number; items: readonly DigestGitHubResultFact[]; truncated: boolean };
  recommendedActions: { count: number; items: readonly DigestGitHubResultFact[]; truncated: boolean };
};

export type DigestGitHubLines = {
  headline: string;
  metrics: string[];
  priorities: string[];
  actions: string[];
};

export type DigestGitHubFacts = Omit<DigestGitHubFactsInput, "changes" | "unknowns" | "staleResults" | "recommendedActions"> & {
  changes: Omit<DigestGitHubFactsInput["changes"], "items"> & { items: DigestGitHubChangeFact[] };
  unknowns: Omit<DigestGitHubFactsInput["unknowns"], "items"> & { items: DigestGitHubResultFact[] };
  staleResults: Omit<DigestGitHubFactsInput["staleResults"], "items"> & { items: DigestGitHubResultFact[] };
  recommendedActions: Omit<DigestGitHubFactsInput["recommendedActions"], "items"> & { items: DigestGitHubResultFact[] };
  lines: DigestGitHubLines;
};

export type DailyDigestFacts = {
  schemaVersion: 2;
  workspace: { id: string; name: string };
  localDate: string;
  overview: ReadinessReport;
  attentionItems: DigestAttentionItem[];
  monitoringFindings: DigestMonitoringFinding[];
  latestLeadershipReport: { id: string; publishedAt: string } | null;
  truncation: { attentionItems: boolean; monitoringFindings: boolean };
  github: DigestGitHubFacts;
};

type BuildDailyDigestFactsInput = {
  workspace: { id: string; name: string };
  localDate: string;
  overview: ReadinessReport;
  attentionItems: readonly DigestAttentionItem[];
  monitoringFindings: readonly DigestMonitoringFinding[];
  latestLeadershipReport: { id: string; publishedAt: string } | null;
  github: DigestGitHubFactsInput;
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

const githubOutcome = z.enum(["pass", "fail", "unknown", "not_applicable"]);
const githubCheckId = z.string().min(1).max(120).regex(/^[a-z0-9._-]+$/);
const nonnegativeCount = z.number().int().nonnegative();

function normalizeGitHubResult(input: DigestGitHubResultFact): DigestGitHubResultFact {
  const id = z.string().refine((value) => value.startsWith("github_result:")
    && z.uuid().safeParse(value.slice("github_result:".length)).success, "GitHub result ID required").parse(input.id);
  const repositoryId = z.uuid().parse(input.repositoryId);
  const repositoryLabel = z.string().max(40).parse(input.repositoryLabel);
  if (repositoryLabel !== `GitHub repository ${repositoryId.slice(0, 8)}`) {
    throw new Error("Unsafe GitHub repository label");
  }
  const result = githubOutcome.parse(input.result);
  const severity = input.severity === null ? null : z.enum(DIGEST_SEVERITIES).parse(input.severity);
  if ((result === "fail") !== (severity !== null)) throw new Error("GitHub failure severity mismatch");
  const observedAt = normaliseDateTime(input.observedAt);
  const freshUntil = normaliseDateTime(input.freshUntil);
  const materialisedAt = normaliseDateTime(input.materialisedAt);
  if (Date.parse(freshUntil) <= Date.parse(observedAt) || Date.parse(materialisedAt) < Date.parse(observedAt)) {
    throw new Error("Invalid GitHub result chronology");
  }
  return {
    id, repositoryId, repositoryLabel,
    checkId: githubCheckId.parse(input.checkId), result, severity,
    summary: cleanFactText(input.summary, 280), observedAt, freshUntil, materialisedAt,
  };
}

function resultOrder(left: DigestGitHubResultFact, right: DigestGitHubResultFact): number {
  return Date.parse(right.observedAt) - Date.parse(left.observedAt)
    || right.id.localeCompare(left.id);
}

function actionOrder(left: DigestGitHubResultFact, right: DigestGitHubResultFact): number {
  return severityRank[right.severity!] - severityRank[left.severity!]
    || resultOrder(left, right);
}

const changeKindRank: Record<DigestGitHubChangeFact["kind"], number> = {
  resolution: 1, superseding_pass: 2, reopen: 3, new_failure: 4,
};

function changeOrder(left: DigestGitHubChangeFact, right: DigestGitHubChangeFact): number {
  return Date.parse(right.materialisedAt) - Date.parse(left.materialisedAt)
    || changeKindRank[left.kind] - changeKindRank[right.kind]
    || right.id.localeCompare(left.id);
}

function validateCountedSection(label: string, count: number, length: number, truncated: boolean): void {
  nonnegativeCount.parse(count);
  if ((!truncated && count !== length) || (truncated && count <= length)) {
    throw new Error(`Invalid GitHub ${label} count/truncation state`);
  }
}

function counted(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function githubLinesFromFacts(facts: Omit<DigestGitHubFacts, "lines">): DigestGitHubLines {
  const partition = facts.partition;
  const headline = `Verified GitHub technical fact: ${counted(partition.activeCurrentFail, "current failure")}`;
  const metrics = [
    `Verified GitHub technical fact: ${counted(partition.total, "official result")}`,
    `Verified GitHub technical fact: ${counted(partition.activeCurrentPass, "current pass")}`,
    `Verified GitHub technical fact: ${counted(partition.activeCurrentFail, "current failure")}`,
    `Unknown GitHub information: ${counted(partition.activeCurrentUnknown, "current result")}`,
    `Verified GitHub technical fact: ${counted(partition.activeCurrentNotApplicable, "current not-applicable result")}`,
    `Stale GitHub result: ${counted(partition.activeStale, "active-mapping result")}`,
    `Verified GitHub technical fact: ${counted(partition.historical, "historical-mapping result")}`,
  ];
  const kindLabel: Record<DigestGitHubChangeFact["kind"], string> = {
    new_failure: "New failure", reopen: "Reopen", resolution: "Resolution", superseding_pass: "Superseding pass",
  };
  const changes = facts.changes.items.map((item) =>
    `Verified GitHub technical fact: ${kindLabel[item.kind]} — ${item.repositoryLabel} — ${item.checkId} — ${item.summary}`);
  const unknowns = facts.unknowns.items.map((item) =>
    `Unknown GitHub information: ${item.repositoryLabel} — ${item.checkId} — ${item.summary}`);
  const stale = facts.staleResults.items.map((item) =>
    `Stale GitHub result: ${item.repositoryLabel} — ${item.checkId} — ${item.result} — ${item.summary}`);
  const actions = facts.recommendedActions.items.map((item) =>
    `Recommended follow-up: Review verified failure — ${item.repositoryLabel} — ${item.checkId} — ${item.summary}`);
  for (const line of [headline, ...metrics, ...changes, ...unknowns, ...stale, ...actions]) cleanFactText(line, 240);
  return { headline, metrics, priorities: [...changes, ...unknowns, ...stale].slice(0, 5), actions: actions.slice(0, 5) };
}

function normalizeGitHubFacts(input: DigestGitHubFactsInput): DigestGitHubFacts {
  const partition = {
    activeCurrentPass: nonnegativeCount.parse(input.partition.activeCurrentPass),
    activeCurrentFail: nonnegativeCount.parse(input.partition.activeCurrentFail),
    activeCurrentUnknown: nonnegativeCount.parse(input.partition.activeCurrentUnknown),
    activeCurrentNotApplicable: nonnegativeCount.parse(input.partition.activeCurrentNotApplicable),
    activeStale: nonnegativeCount.parse(input.partition.activeStale),
    historical: nonnegativeCount.parse(input.partition.historical),
    total: nonnegativeCount.parse(input.partition.total),
  };
  const partitionSum = partition.activeCurrentPass + partition.activeCurrentFail
    + partition.activeCurrentUnknown + partition.activeCurrentNotApplicable
    + partition.activeStale + partition.historical;
  if (partitionSum !== partition.total) throw new Error("Invalid GitHub partition sum");

  const baseline = input.baseline === null ? null : {
    deliveredAt: normaliseDateTime(input.baseline.deliveredAt),
    localDate: localDateSchema.parse(input.baseline.localDate),
  };
  const changes = input.changes.items.map((item): DigestGitHubChangeFact => {
    const kind = z.enum(DIGEST_GITHUB_CHANGE_KINDS).parse(item.kind);
    const result = normalizeGitHubResult({ ...item, id: item.resultId });
    const id = `github_change:${kind}:${result.id.slice("github_result:".length)}`;
    if (item.id !== id) throw new Error("Invalid GitHub change ID");
    const expectedResult = kind === "new_failure" || kind === "reopen" ? "fail" : "pass";
    if (result.result !== expectedResult) {
      throw new Error("Invalid GitHub change outcome");
    }
    return { ...result, id, resultId: result.id, kind, occurredAt: normaliseDateTime(item.occurredAt) };
  }).sort(changeOrder);
  const counts = {
    newFailure: nonnegativeCount.parse(input.changes.counts.newFailure),
    reopen: nonnegativeCount.parse(input.changes.counts.reopen),
    resolution: nonnegativeCount.parse(input.changes.counts.resolution),
    supersedingPass: nonnegativeCount.parse(input.changes.counts.supersedingPass),
    total: nonnegativeCount.parse(input.changes.counts.total),
  };
  if (counts.newFailure + counts.reopen + counts.resolution + counts.supersedingPass !== counts.total) {
    throw new Error("Invalid GitHub change count sum");
  }
  validateCountedSection("change", counts.total, changes.length, input.changes.truncated);
  if (baseline === null && counts.total !== 0) throw new Error("GitHub changes require a delivered baseline");

  const unknowns = input.unknowns.items.map(normalizeGitHubResult).sort(resultOrder);
  if (unknowns.some(({ result }) => result !== "unknown")) throw new Error("Invalid GitHub unknown result");
  validateCountedSection("unknown", input.unknowns.count, unknowns.length, input.unknowns.truncated);
  const staleResults = input.staleResults.items.map(normalizeGitHubResult).sort(resultOrder);
  validateCountedSection("stale", input.staleResults.count, staleResults.length, input.staleResults.truncated);
  const recommendedActions = input.recommendedActions.items.map(normalizeGitHubResult).sort(actionOrder);
  if (recommendedActions.some(({ result }) => result !== "fail")) throw new Error("Invalid GitHub recommended action");
  validateCountedSection("recommended action", input.recommendedActions.count, recommendedActions.length, input.recommendedActions.truncated);
  if (input.unknowns.count !== partition.activeCurrentUnknown
    || input.staleResults.count !== partition.activeStale
    || input.recommendedActions.count !== partition.activeCurrentFail) {
    throw new Error("GitHub section counts do not match partition");
  }
  for (const [label, items] of [["change", changes], ["unknown", unknowns], ["stale", staleResults], ["recommended action", recommendedActions]] as const) {
    if (new Set(items.map(({ id }) => id)).size !== items.length) throw new Error(`Duplicate GitHub ${label} ID`);
  }
  const normalized = {
    partition, baseline,
    changes: { counts, items: changes, truncated: z.boolean().parse(input.changes.truncated) },
    unknowns: { count: input.unknowns.count, items: unknowns, truncated: z.boolean().parse(input.unknowns.truncated) },
    staleResults: { count: input.staleResults.count, items: staleResults, truncated: z.boolean().parse(input.staleResults.truncated) },
    recommendedActions: { count: input.recommendedActions.count, items: recommendedActions, truncated: z.boolean().parse(input.recommendedActions.truncated) },
  };
  return { ...normalized, lines: githubLinesFromFacts(normalized) };
}

export function buildGitHubDigestLines(input: DigestGitHubFactsInput): DigestGitHubLines {
  return normalizeGitHubFacts(input).lines;
}

export function buildDailyDigestFacts(input: BuildDailyDigestFactsInput): DailyDigestFacts {
  if (!input.github) throw new Error("Verified GitHub digest facts are required");
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
    schemaVersion: 2,
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
    github: normalizeGitHubFacts(input.github),
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
    facts.github.lines.headline,
    ...facts.github.lines.metrics,
    ...facts.github.lines.priorities,
    ...facts.github.lines.actions,
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
  const overview = facts.overview;
  const counted = (count: number, singular: string, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;
  const canonical = new Set([
    `${overview.soaPercent}% readiness`,
    counted(overview.soaTotal, "SoA control"),
    counted(overview.soaTotal, "control"),
    counted(overview.tasksOpen, "open task"),
    counted(overview.tasksOverdue, "overdue task"),
    counted(overview.evidence.total, "evidence item"),
    `${overview.evidence.total} total evidence`,
    `${overview.evidence.expiring} expiring evidence`,
    `${overview.evidence.expired} expired evidence`,
    counted(overview.riskBands.very_high, "very-high risk"),
    counted(overview.riskBands.high, "high risk"),
    counted(overview.riskBands.moderate, "moderate risk"),
    counted(overview.riskBands.low, "low risk"),
    counted(overview.openAudits, "open audit"),
    counted(overview.openNonConformities, "open non-conformity", "open non-conformities"),
  ].map((line) => line.toLowerCase()));
  const normalized = text.toLowerCase();
  if (canonical.has(normalized)) return true;
  const action = normalized.match(/^(?:review|address|resolve|investigate|prioritize|prioritise)\s+(.+)$/);
  return Boolean(action?.[1] && canonical.has(action[1]));
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
