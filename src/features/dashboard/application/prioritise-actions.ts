// Decision-first dashboard: turn the workspace's open work into a single,
// deterministically-ordered "do this next" queue. Pure domain logic — the page
// projects Supabase rows into DashboardActionInput and renders the result.

export type DashboardActionKind =
  | "soa_decision"
  | "evidence_review"
  | "approval"
  | "task"
  | "risk_treatment";

export type ActionSeverity = "blocker" | "high" | "normal";

export type DashboardActionInput = {
  id: string;
  kind: DashboardActionKind;
  label: string;
  explanation: string;
  destination: string;
  source: string;
  dueOn?: string | null;
  owner?: string | null;
  severity?: ActionSeverity;
};

export type PrioritisedAction = {
  id: string;
  kind: DashboardActionKind;
  label: string;
  explanation: string;
  destination: string;
  source: string;
  dueOn: string | null;
  owner: string | null;
  severity: ActionSeverity;
  priorityReason: string;
  dueContext: string;
};

export const MAX_DASHBOARD_ACTIONS = 5;

const SEVERITY_RANK: Record<ActionSeverity, number> = { blocker: 0, high: 1, normal: 2 };

// Review-style decisions are surfaced ahead of ordinary due work of equal
// severity: a pending SoA decision or an ageing evidence item is a judgement
// call the user should make before working a routine task.
const REVIEW_KINDS = new Set<DashboardActionKind>(["soa_decision", "evidence_review"]);
const categoryRank = (kind: DashboardActionKind): number => (REVIEW_KINDS.has(kind) ? 0 : 1);

const isOverdue = (dueOn: string | null, today: string): boolean => dueOn !== null && dueOn < today;

function priorityReason(action: PrioritisedAction, today: string): string {
  if (action.severity === "blocker") return "Blocking — clear this to move forward";
  if (isOverdue(action.dueOn, today)) return "Overdue";
  if (action.dueOn === today) return "Due today";
  if (categoryRank(action.kind) === 0) return "Ready for your review";
  return action.dueOn ? "Scheduled" : "When you're ready";
}

function dueContext(dueOn: string | null, today: string): string {
  if (!dueOn) return "No due date";
  if (dueOn < today) return "Overdue";
  if (dueOn === today) return "Due today";
  return `Due ${dueOn}`;
}

function compareActions(a: PrioritisedAction, b: PrioritisedAction, today: string): number {
  const severity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (severity !== 0) return severity;

  const category = categoryRank(a.kind) - categoryRank(b.kind);
  if (category !== 0) return category;

  const overdue = Number(isOverdue(b.dueOn, today)) - Number(isOverdue(a.dueOn, today));
  if (overdue !== 0) return overdue;

  if (a.dueOn && b.dueOn && a.dueOn !== b.dueOn) return a.dueOn < b.dueOn ? -1 : 1;
  if (a.dueOn && !b.dueOn) return -1;
  if (!a.dueOn && b.dueOn) return 1;

  // Deterministic final tie-break so the same inputs always render the same order.
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Order the workspace's open work into a "do this next" queue: blockers first,
 * then review decisions, then ordinary due work; overdue before upcoming; ties
 * broken by id. Returns at most `limit` (default {@link MAX_DASHBOARD_ACTIONS}).
 */
export function prioritiseDashboardActions(
  actions: readonly DashboardActionInput[],
  today: string,
  limit: number = MAX_DASHBOARD_ACTIONS,
): PrioritisedAction[] {
  const enriched: PrioritisedAction[] = actions.map((action) => {
    const severity = action.severity ?? "normal";
    const dueOn = action.dueOn ?? null;
    const base: PrioritisedAction = {
      id: action.id,
      kind: action.kind,
      label: action.label,
      explanation: action.explanation,
      destination: action.destination,
      source: action.source,
      dueOn,
      owner: action.owner ?? null,
      severity,
      priorityReason: "",
      dueContext: dueContext(dueOn, today),
    };
    return { ...base, priorityReason: priorityReason(base, today) };
  });

  enriched.sort((a, b) => compareActions(a, b, today));
  return enriched.slice(0, Math.max(0, limit));
}
