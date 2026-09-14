export type RtpStatus = "planned" | "in_progress" | "completed" | "cancelled";
export const RTP_STATUS_LABEL: Record<RtpStatus, string> = { planned: "Planned", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" };
export const RTP_STATUS_TONE: Record<RtpStatus, string> = { planned: "neutral", in_progress: "amber", completed: "green", cancelled: "neutral" };

export function summariseRtpProgress(plans: readonly { status: RtpStatus }[]): { total: number; completed: number; cancelled: number; open: number; allComplete: boolean } {
  const total = plans.length;
  const completed = plans.filter((p) => p.status === "completed").length;
  const cancelled = plans.filter((p) => p.status === "cancelled").length;
  const open = total - completed - cancelled;
  return { total, completed, cancelled, open, allComplete: total > 0 && completed === total };
}

/** Suggests an unused workspace reference; persistence must still enforce uniqueness. */
export function nextRtpReference(workspaceReferences: readonly string[]): string {
  const used = new Set(workspaceReferences);
  let number = 1;
  let reference = `RTP-${String(number).padStart(3, "0")}`;
  while (used.has(reference)) {
    number += 1;
    reference = `RTP-${String(number).padStart(3, "0")}`;
  }
  return reference;
}
