export type AiSourceReference = {
  type: "assessment_question" | "soa_item" | "audit" | "readiness_report";
  id: string;
  label: string;
};

export type AiContext = {
  kind: "assessment" | "soa" | "audit" | "readiness_report";
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
