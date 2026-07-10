export type AiSourceReference = {
  type: "assessment_question" | "soa_item" | "audit" | "readiness_report" | "task" | "evidence" | "risk" | "automation_proposal" | "automation_signal" | "source_object";
  id: string;
  label: string;
};

export type AiContext = {
  kind: "assessment" | "soa" | "audit" | "readiness_report" | "task" | "evidence" | "risk" | "automation_proposal";
  target: { id: string; code: string };
  facts: Record<string, string | boolean>;
  sourceReferences: AiSourceReference[];
};

type AssessmentInput = {
  sessionId: string;
  question: { id: string; code: string; prompt: string };
  answer: string | null;
  evidenceNote?: string | null;
};

type SoaInput = {
  item: { id: string; controlCode: string; controlTitle: string; applicable: boolean; status: string };
  justification?: string | null;
  evidence?: string | null;
};

export function buildAssessmentAiContext(input: AssessmentInput): AiContext {
  void input.sessionId;
  void input.evidenceNote;
  return {
    kind: "assessment",
    target: { id: input.question.id, code: input.question.code },
    facts: { answer: input.answer ?? "not_answered", question: input.question.prompt },
    sourceReferences: [{ type: "assessment_question", id: input.question.id, label: input.question.code }],
  };
}

export function buildSoaAiContext(input: SoaInput): AiContext {
  void input.justification;
  void input.evidence;
  return {
    kind: "soa",
    target: { id: input.item.id, code: input.item.controlCode },
    facts: { applicable: input.item.applicable, status: input.item.status, control: input.item.controlTitle },
    sourceReferences: [{ type: "soa_item", id: input.item.id, label: input.item.controlCode }],
  };
}

export function buildAuditAiContext(input: { audit: { id: string; reference: string; title: string; status: string }; scope?: string; checklistNotes?: string }): AiContext {
  void input.scope;
  void input.checklistNotes;
  return {
    kind: "audit",
    target: { id: input.audit.id, code: input.audit.reference },
    facts: { audit: input.audit.title, status: input.audit.status },
    sourceReferences: [{ type: "audit", id: input.audit.id, label: input.audit.reference }],
  };
}

export function buildReadinessAiContext(input: { organisationId: string; soaPercent: number; tasksOpen: number; tasksOverdue: number; evidenceExpired: number; openFindings: number }): AiContext {
  return {
    kind: "readiness_report",
    target: { id: input.organisationId, code: "readiness" },
    facts: { soaPercent: String(input.soaPercent), tasksOpen: String(input.tasksOpen), tasksOverdue: String(input.tasksOverdue), evidenceExpired: String(input.evidenceExpired), openFindings: String(input.openFindings) },
    sourceReferences: [{ type: "readiness_report", id: input.organisationId, label: "Current readiness report" }],
  };
}

export function buildTaskAiContext(input: { task: { id: string; title: string; status: string; source: string; dueOn: string | null }; detail?: string }): AiContext {
  void input.detail;
  return { kind: "task", target: { id: input.task.id, code: "task" }, facts: { task: input.task.title, status: input.task.status, source: input.task.source, dueOn: input.task.dueOn ?? "not_set" }, sourceReferences: [{ type: "task", id: input.task.id, label: input.task.title }] };
}

export function buildEvidenceAiContext(input: { evidence: { id: string; title: string; kind: string; status: string; collectedOn: string; validUntil: string | null }; description?: string; url?: string | null }): AiContext {
  void input.description;
  void input.url;
  return { kind: "evidence", target: { id: input.evidence.id, code: "evidence" }, facts: { evidence: input.evidence.title, kind: input.evidence.kind, status: input.evidence.status, collectedOn: input.evidence.collectedOn, validUntil: input.evidence.validUntil ?? "not_set" }, sourceReferences: [{ type: "evidence", id: input.evidence.id, label: input.evidence.title }] };
}

export function buildRiskAiContext(input: { risk: { id: string; reference: string; title: string; status: string; treatment: string }; description?: string; likelihood?: number; impact?: number; treatmentPlan?: string }): AiContext {
  void input.description;
  void input.likelihood;
  void input.impact;
  void input.treatmentPlan;
  return { kind: "risk", target: { id: input.risk.id, code: input.risk.reference }, facts: { risk: input.risk.title, status: input.risk.status, treatment: input.risk.treatment }, sourceReferences: [{ type: "risk", id: input.risk.id, label: input.risk.reference }] };
}

export function buildAutomationProposalAiContext(input: {
  proposal: { id: string; targetType: string; title: string; confidence: string };
  signal: { id: string; type: string; summary: string };
  sourceObject?: { id: string; title: string; contentRef?: string; content?: string } | null;
}): AiContext {
  void input.sourceObject?.contentRef;
  void input.sourceObject?.content;
  return {
    kind: "automation_proposal",
    target: { id: input.proposal.id, code: "automation" },
    facts: { targetType: input.proposal.targetType, title: input.proposal.title, confidence: input.proposal.confidence, signal: input.signal.type, summary: input.signal.summary },
    sourceReferences: [
      { type: "automation_proposal", id: input.proposal.id, label: input.proposal.title },
      { type: "automation_signal", id: input.signal.id, label: input.signal.type },
      ...(input.sourceObject ? [{ type: "source_object" as const, id: input.sourceObject.id, label: input.sourceObject.title }] : []),
    ],
  };
}
