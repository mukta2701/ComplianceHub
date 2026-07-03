export type TaskStatus = "open" | "in_progress" | "done" | "cancelled";
export type TaskRecurrence = "weekly" | "monthly" | "quarterly" | "semiannually" | "annually";
export type GapForTask = Readonly<{ questionId: string; category: string; prompt: string; remediation: string }>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS: Record<Exclude<TaskRecurrence, "weekly">, number> = { monthly: 1, quarterly: 3, semiannually: 6, annually: 12 };

function addMonthsClamped(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const daysInTarget = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, daysInTarget));
  return first.toISOString().slice(0, 10);
}

export function nextDueDate(dueOn: string, recurrence: TaskRecurrence): string {
  if (!ISO_DATE.test(dueOn)) throw new RangeError("Due date must be an ISO date (YYYY-MM-DD)");
  if (recurrence === "weekly") {
    const [year, month, day] = dueOn.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day + 7)).toISOString().slice(0, 10);
  }
  return addMonthsClamped(dueOn, MONTHS[recurrence]);
}

export function isOverdue(task: { status: TaskStatus; dueOn: string | null }, today: string): boolean {
  if (!ISO_DATE.test(today)) throw new RangeError("Today must be an ISO date (YYYY-MM-DD)");
  return (task.status === "open" || task.status === "in_progress") && task.dueOn !== null && task.dueOn < today;
}

export function suggestTasksFromGaps(gaps: readonly GapForTask[]) {
  return gaps.map((gap) => ({
    sourceQuestionId: gap.questionId,
    title: `Close gap: ${gap.prompt}`,
    detail: gap.remediation,
    source: "gap" as const,
  }));
}
