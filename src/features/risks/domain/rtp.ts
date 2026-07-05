export type RtpStatus = "planned" | "in_progress" | "completed" | "cancelled";
export const RTP_STATUS_LABEL: Record<RtpStatus, string> = { planned: "Planned", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled" };
export const RTP_STATUS_TONE: Record<RtpStatus, string> = { planned: "neutral", in_progress: "amber", completed: "green", cancelled: "neutral" };

export function summariseRtpProgress(plans: readonly { status: RtpStatus }[]): { total: number; completed: number; open: number; allComplete: boolean } {
  const total = plans.length;
  const completed = plans.filter((p) => p.status === "completed").length;
  const cancelled = plans.filter((p) => p.status === "cancelled").length;
  const open = total - completed - cancelled;
  return { total, completed, open, allComplete: total > 0 && open === 0 };
}
