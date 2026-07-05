import type { AssessmentResponse } from "../../assessment/domain/types";

export type SoaStatus = "pending" | "absent" | "in_progress" | "established" | "operational" | "advanced" | "not_applicable";

export const SOA_STATUS_LABEL: Record<SoaStatus, string> = {
  pending: "Pending",
  absent: "Absent",
  in_progress: "In Progress",
  established: "Established",
  operational: "Operational",
  advanced: "Advanced",
  not_applicable: "Not Applicable",
};
export type SoaItem = {
  questionId: string;
  suggestedStatus: SoaStatus;
  status: SoaStatus;
  reviewed: boolean;
  justification: string;
  evidence: string;
};
export type SoaDraft = { assessmentId: string; items: SoaItem[] };
export type SoaSnapshot = Readonly<SoaDraft & {
  version: number;
  finalisedAt: string;
  finalisedBy: string;
}>;

const suggestions: Record<AssessmentResponse["answer"], SoaStatus> = {
  yes: "operational",
  partially: "in_progress",
  no: "pending",
  not_applicable: "not_applicable",
};

export function createSoaDraft(assessmentId: string, responses: readonly AssessmentResponse[]): SoaDraft {
  return {
    assessmentId,
    items: responses.map((response) => ({
      questionId: response.questionId,
      suggestedStatus: suggestions[response.answer],
      status: suggestions[response.answer],
      reviewed: false,
      justification: "",
      evidence: response.evidenceNote ?? "",
    })),
  };
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function createSoaSnapshot(
  draft: SoaDraft,
  metadata: { version: number; finalisedAt: string; finalisedBy: string },
): SoaSnapshot {
  return deepFreeze(structuredClone({ ...draft, ...metadata })) as SoaSnapshot;
}
