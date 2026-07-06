import type { CreateTicketInput } from "./provider";

export const TICKET_SYNC_MAX_AGE_MINUTES = 30;

export function buildTicketPayload(task: {
  title: string; detail?: string | null; source?: string | null; controlCode?: string | null;
}): CreateTicketInput {
  const lines = [
    task.detail?.trim() || "No further detail was recorded.",
    "",
    task.controlCode ? `Linked control: ${task.controlCode}` : null,
    task.source ? `Source: ${task.source}` : null,
    "Raised from ComplianceHub.",
  ].filter((l): l is string => l !== null);
  return { title: task.title.slice(0, 200), body: lines.join("\n") };
}

export function isTicketSyncDue(
  ticket: { lastSyncedAt: string | null },
  nowIso: string,
  maxAgeMinutes: number = TICKET_SYNC_MAX_AGE_MINUTES,
): boolean {
  if (ticket.lastSyncedAt === null) return true;
  const ageMs = Date.parse(nowIso) - Date.parse(ticket.lastSyncedAt);
  return ageMs >= maxAgeMinutes * 60 * 1000;
}

export function ticketStatusTone(status: string): string {
  const s = status.trim().toLowerCase();
  if (s === "done" || s === "closed" || s === "resolved") return "green";
  if (s === "in progress" || s === "in review") return "amber";
  if (s === "to do" || s === "open" || s === "backlog") return "neutral";
  return "blue";
}
