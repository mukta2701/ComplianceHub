import { z } from "zod";

export const assessmentAutosaveSchema = z.object({
  sessionId: z.uuid(),
  questionId: z.uuid(),
  answer: z.enum(["yes", "partially", "no", "not_applicable"]),
  evidenceNote: z.string().max(10_000).default(""),
  expectedRevision: z.number().int().nonnegative(),
});

export type AssessmentAutosaveInput = z.infer<typeof assessmentAutosaveSchema>;

export class AssessmentRevisionConflictError extends Error {
  readonly code = "ASSESSMENT_REVISION_CONFLICT";
  constructor() { super("This assessment changed elsewhere. Reload it before saving again."); }
}

export async function saveAssessmentResponse(
  input: unknown,
  adapter: { save: (value: AssessmentAutosaveInput) => Promise<{ revision: number }> },
) {
  const parsed = assessmentAutosaveSchema.parse(input);
  try {
    return await adapter.save(parsed);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "40001") {
      throw new AssessmentRevisionConflictError();
    }
    throw error;
  }
}
