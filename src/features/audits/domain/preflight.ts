export type AuditPreflightInput = {
  pendingControls: number;
  ownerGaps: number;
  expiredEvidence: number;
  overdueTasks: number;
  openFindings: number;
  scopeGaps?: number;
};

export function assessAuditPreflight(input: AuditPreflightInput) {
  const blockers: string[] = [];
  if (input.scopeGaps) blockers.push(`${input.scopeGaps} organisation scope decision${input.scopeGaps === 1 ? " is" : "s are"} incomplete.`);
  if (input.pendingControls) blockers.push(`${input.pendingControls} applicable SoA control${input.pendingControls === 1 ? "" : "s"} still need review.`);
  if (input.ownerGaps) blockers.push(`${input.ownerGaps} applicable SoA control${input.ownerGaps === 1 ? "" : "s"} ${input.ownerGaps === 1 ? "has" : "have"} no owner.`);
  if (input.expiredEvidence) blockers.push(`${input.expiredEvidence} evidence record${input.expiredEvidence === 1 ? " is" : "s are"} expired.`);
  if (input.overdueTasks) blockers.push(`${input.overdueTasks} remediation task${input.overdueTasks === 1 ? " is" : "s are"} overdue.`);
  if (input.openFindings) blockers.push(`${input.openFindings} audit finding${input.openFindings === 1 ? " remains" : "s remain"} open.`);
  return blockers;
}
