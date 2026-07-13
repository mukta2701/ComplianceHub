export type AuditStatus = "planned" | "in_progress" | "reporting" | "closed";
export type ChecklistResult = "compliant" | "non_compliant" | "not_applicable" | "not_tested";
export type FindingSeverity = "observation" | "minor_nc" | "major_nc";
export type FindingStatus = "open" | "in_progress" | "closed";

export const AUDIT_STATUS_LABEL: Record<AuditStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  reporting: "Reporting",
  closed: "Closed",
};
export const AUDIT_STATUS_TONE: Record<AuditStatus, string> = {
  planned: "neutral",
  in_progress: "amber",
  reporting: "blue",
  closed: "green",
};

export const CHECKLIST_RESULT_LABEL: Record<ChecklistResult, string> = {
  compliant: "Compliant",
  non_compliant: "Non-compliant",
  not_applicable: "Not applicable",
  not_tested: "Not tested",
};
export const CHECKLIST_RESULT_TONE: Record<ChecklistResult, string> = {
  compliant: "green",
  non_compliant: "red",
  not_applicable: "neutral",
  not_tested: "amber",
};

export const FINDING_SEVERITY_LABEL: Record<FindingSeverity, string> = {
  observation: "Observation",
  minor_nc: "Minor non-conformity",
  major_nc: "Major non-conformity",
};
export const FINDING_SEVERITY_TONE: Record<FindingSeverity, string> = {
  observation: "neutral",
  minor_nc: "amber",
  major_nc: "critical",
};

export const FINDING_STATUS_LABEL: Record<FindingStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  closed: "Closed",
};
export const FINDING_STATUS_TONE: Record<FindingStatus, string> = {
  open: "red",
  in_progress: "amber",
  closed: "green",
};

export function checklistCompletion(
  items: readonly { compliant: ChecklistResult }[],
): { tested: number; total: number; percent: number } {
  const total = items.length;
  const tested = items.filter((item) => item.compliant !== "not_tested").length;
  return { tested, total, percent: total === 0 ? 0 : Math.round((tested / total) * 100) };
}

export function summariseFindings(
  findings: readonly { severity: FindingSeverity; status: FindingStatus }[],
): { total: number; open: number; majorNc: number; minorNc: number; observations: number; openNonConformities: number } {
  const total = findings.length;
  const open = findings.filter((finding) => finding.status !== "closed").length;
  const majorNc = findings.filter((finding) => finding.severity === "major_nc").length;
  const minorNc = findings.filter((finding) => finding.severity === "minor_nc").length;
  const observations = findings.filter((finding) => finding.severity === "observation").length;
  const openNonConformities = findings.filter(
    (finding) => finding.status !== "closed" && finding.severity !== "observation",
  ).length;
  return { total, open, majorNc, minorNc, observations, openNonConformities };
}

type AuditorAccessLogRow = {
  viewed_at: string;
  auditor_access_tokens: { label: string } | { label: string }[] | null;
};

export function recentAuditorViews(
  rows: readonly AuditorAccessLogRow[],
): { label: string; viewedAt: string }[] {
  return rows.slice(0, 10).map((row) => {
    const token = Array.isArray(row.auditor_access_tokens)
      ? row.auditor_access_tokens[0]
      : row.auditor_access_tokens;
    return {
      label: token?.label.trim() || "Auditor link",
      viewedAt: row.viewed_at,
    };
  });
}
