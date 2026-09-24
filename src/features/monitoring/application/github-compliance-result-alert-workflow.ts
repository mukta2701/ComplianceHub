import "server-only";

import { z } from "zod";

import { EXPECTED_GITHUB_CHECK_IDS } from "@/features/github/domain/rules";
import { buildComplianceResultAlertEvent } from "./compliance-result-alert-event";

const UUID = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const outcome = z.enum(["pass", "fail", "unknown", "not_applicable"]);
const incidentKind = z.enum(["failure", "sustained_unknown", "stale"]);
const checkId = z.enum(EXPECTED_GITHUB_CHECK_IDS);

const activeIncidentSchema = z.object({
  kind: incidentKind,
  incidentKey: z.string().regex(/^[0-9a-f]{64}$/),
  startedAt: timestamp,
}).strict();

const candidateSchema = z.object({
  collectionRunId: UUID,
  organisationId: UUID,
  repositoryId: UUID,
  repositorySlug: z.string().min(3).max(201).regex(/^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,98}[A-Za-z0-9])?$/),
  checkId,
  result: z.object({
    id: UUID,
    outcome,
    observedAt: timestamp,
    freshUntil: timestamp,
    findingId: UUID.nullable(),
    evidenceId: UUID.nullable(),
    severity: z.enum(["low", "medium", "high", "critical"]).nullable(),
  }).strict(),
  state: z.object({
    revision: z.number().int().nonnegative().nullable(),
    currentResultId: UUID.nullable(),
    currentOutcome: outcome.nullable(),
    actionableUnknownSince: timestamp.nullable(),
    activeIncident: activeIncidentSchema.nullable(),
  }).strict().superRefine((state, context) => {
    if ((state.currentResultId === null) !== (state.currentOutcome === null)
      || (state.revision === null) !== (state.currentResultId === null)) {
      context.addIssue({ code: "custom", message: "Alert state is inconsistent" });
    }
  }),
}).strict();

const loadResultSchema = z.object({
  candidates: z.array(candidateSchema).max(100),
  hasMore: z.boolean(),
}).strict();

const saveResultSchema = z.object({
  processed: z.number().int().nonnegative().max(100),
  conflicts: z.number().int().nonnegative().max(100),
  eventsCreated: z.number().int().nonnegative().max(100),
  notificationsCreated: z.number().int().nonnegative().safe(),
}).strict();

type Candidate = z.infer<typeof candidateSchema>;
type Cursor = { organisationId: string; repositoryId: string; checkId: string };
type CollectionScope = { collectionRunId: string; organisationId: string };
type DueScope = { due: true };

type AlertDecisionPort = {
  loadCandidates(input: {
    evaluatedAt: string;
    collectionRunId?: string;
    organisationId?: string;
    after?: Cursor;
    limit: number;
  }): Promise<unknown>;
  saveDecisions(decisions: unknown[], evaluatedAt: string): Promise<unknown>;
};

export type GitHubComplianceResultAlertCandidate = Candidate;

export type GitHubComplianceResultAlertRunOptions = {
  evaluatedAt: string;
  appOrigin: string;
  allowLocalHttp?: boolean;
  scope: CollectionScope | DueScope;
};

type AlertDecision = {
  organisationId: string;
  repositoryId: string;
  checkId: string;
  expectedRevision: number | null;
  currentResultId: string;
  currentOutcome: Candidate["result"]["outcome"];
  actionableUnknownSince: string | null;
  nextActiveIncident: Candidate["state"]["activeIncident"];
  nextEvaluationAt: string | null;
  event: null | {
    kind: string;
    incidentKey: string;
    idempotencyKey: string;
    incidentStartedAt: string;
    resultId: string;
    recordUrl: string;
    notificationMessage: string;
  };
};

const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const UNKNOWN_ACTIONABLE_AFTER_MS = 36 * 60 * 60 * 1000;

function persistenceFailure(): Error {
  return new Error("GitHub compliance alert evaluation failed");
}

function keyFor(candidate: Candidate): string {
  return `${candidate.organisationId}\n${candidate.repositoryId}\n${candidate.checkId}`;
}

function isAfter(left: Cursor, right: Cursor | null): boolean {
  if (!right) return true;
  return left.organisationId > right.organisationId
    || (left.organisationId === right.organisationId && left.repositoryId > right.repositoryId)
    || (left.organisationId === right.organisationId && left.repositoryId === right.repositoryId && left.checkId > right.checkId);
}

function decisionFor(candidate: Candidate, options: GitHubComplianceResultAlertRunOptions): AlertDecision {
  const unknownSince = candidate.result.outcome !== "unknown"
    ? null
    : candidate.state.currentOutcome === "unknown" && candidate.state.actionableUnknownSince
      ? candidate.state.actionableUnknownSince
      : candidate.result.observedAt;
  const decision = buildComplianceResultAlertEvent({
    organisationId: candidate.organisationId,
    repositoryId: candidate.repositoryId,
    repositorySlug: candidate.repositorySlug,
    checkId: candidate.checkId,
    previousOutcome: candidate.state.currentOutcome,
    current: candidate.result,
    actionableUnknownSince: unknownSince,
    activeIncident: candidate.state.activeIncident,
    evaluatedAt: options.evaluatedAt,
    appOrigin: options.appOrigin,
    allowLocalHttp: options.allowLocalHttp,
  });
  if (decision.status === "blocked") throw persistenceFailure();

  const nextActiveIncident = decision.status === "event"
    ? decision.event.kind === "recovery"
      ? null
      : {
          kind: decision.event.kind,
          incidentKey: decision.event.incidentKey,
          startedAt: decision.event.incidentStartedAt,
        }
    : candidate.state.activeIncident;
  const nextEvaluationAt = Date.parse(options.evaluatedAt) >= Date.parse(candidate.result.freshUntil)
    ? null
    : candidate.result.outcome === "unknown" && nextActiveIncident?.kind !== "sustained_unknown"
      ? new Date(Math.min(
          Date.parse(candidate.result.freshUntil),
          Date.parse(unknownSince!) + UNKNOWN_ACTIONABLE_AFTER_MS,
        )).toISOString()
      : candidate.result.freshUntil;
  const notificationMessage = decision.status === "event"
    ? decision.event.text.split("\n").slice(0, -1).join(" · ")
    : null;

  return {
    organisationId: candidate.organisationId,
    repositoryId: candidate.repositoryId,
    checkId: candidate.checkId,
    expectedRevision: candidate.state.revision,
    currentResultId: candidate.result.id,
    currentOutcome: candidate.result.outcome,
    actionableUnknownSince: unknownSince,
    nextActiveIncident,
    nextEvaluationAt,
    event: decision.status === "event" ? {
      kind: decision.event.kind,
      incidentKey: decision.event.incidentKey,
      idempotencyKey: decision.event.idempotencyKey,
      incidentStartedAt: decision.event.incidentStartedAt,
      resultId: candidate.result.id,
      recordUrl: decision.event.recordUrl,
      notificationMessage: notificationMessage!,
    } : null,
  };
}

function parseCandidates(value: unknown, options: GitHubComplianceResultAlertRunOptions): z.infer<typeof loadResultSchema> {
  const parsed = loadResultSchema.safeParse(value);
  if (!parsed.success) throw persistenceFailure();
  const seen = new Set<string>();
  let previous: Cursor | null = null;
  for (const candidate of parsed.data.candidates) {
    if ("collectionRunId" in options.scope
      && (candidate.collectionRunId !== options.scope.collectionRunId
        || candidate.organisationId !== options.scope.organisationId)) throw persistenceFailure();
    const cursor = {
      organisationId: candidate.organisationId,
      repositoryId: candidate.repositoryId,
      checkId: candidate.checkId,
    };
    if (!isAfter(cursor, previous) || seen.has(keyFor(candidate))) throw persistenceFailure();
    seen.add(keyFor(candidate));
    previous = cursor;
  }
  return parsed.data;
}

export async function processGitHubComplianceResultAlerts(
  deps: AlertDecisionPort,
  options: GitHubComplianceResultAlertRunOptions,
): Promise<{ candidates: number; eventsCreated: number; notificationsCreated: number; conflicts: number }> {
  const parsedOptions = z.object({
    evaluatedAt: timestamp,
    appOrigin: z.string().min(1).max(2_000),
    allowLocalHttp: z.boolean().optional(),
    scope: z.union([
      z.object({ collectionRunId: UUID, organisationId: UUID }).strict(),
      z.object({ due: z.literal(true) }).strict(),
    ]),
  }).strict().safeParse(options);
  if (!parsedOptions.success) throw persistenceFailure();

  const summary = { candidates: 0, eventsCreated: 0, notificationsCreated: 0, conflicts: 0 };
  let after: Cursor | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const scope = parsedOptions.data.scope;
    const query = {
      evaluatedAt: parsedOptions.data.evaluatedAt,
      ...("collectionRunId" in scope
        ? { collectionRunId: scope.collectionRunId, organisationId: scope.organisationId }
        : {}),
      ...(after ? { after } : {}),
      limit: PAGE_SIZE,
    };
    let raw: unknown;
    try {
      raw = await deps.loadCandidates(query);
    } catch {
      throw persistenceFailure();
    }
    const result = parseCandidates(raw, parsedOptions.data);
    if (after) {
      const prior = after;
      if (result.candidates.some((candidate) => !isAfter({
        organisationId: candidate.organisationId,
        repositoryId: candidate.repositoryId,
        checkId: candidate.checkId,
      }, prior))) throw persistenceFailure();
    }
    if (result.candidates.length === 0 && result.hasMore) throw persistenceFailure();
    if (result.candidates.length > 0) {
      const last = result.candidates[result.candidates.length - 1]!;
      after = { organisationId: last.organisationId, repositoryId: last.repositoryId, checkId: last.checkId };
      const decisions = result.candidates.map((candidate) => decisionFor(candidate, parsedOptions.data));
      let saveRaw: unknown;
      try {
        saveRaw = await deps.saveDecisions(decisions, parsedOptions.data.evaluatedAt);
      } catch {
        throw persistenceFailure();
      }
      const saved = saveResultSchema.safeParse(saveRaw);
      if (!saved.success
        || saved.data.processed + saved.data.conflicts !== decisions.length
        || saved.data.eventsCreated > decisions.filter((decision) => decision.event !== null).length) {
        throw persistenceFailure();
      }
      summary.candidates += decisions.length;
      summary.eventsCreated += saved.data.eventsCreated;
      summary.notificationsCreated += saved.data.notificationsCreated;
      summary.conflicts += saved.data.conflicts;
    }
    if (!result.hasMore) return summary;
  }
  throw persistenceFailure();
}
