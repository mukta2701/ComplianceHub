export type AiSourceReference = {
  type: "assessment_question" | "soa_item";
  id: string;
  label: string;
};

export type AiContext = {
  kind: "assessment" | "soa";
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
