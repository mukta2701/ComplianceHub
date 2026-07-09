import { describe, expect, it } from "vitest";
import { buildAssessmentAiContext } from "@/features/ai/domain/context";
import { generateAiSuggestion, type AiProvider } from "./suggestion";

const context = buildAssessmentAiContext({
  sessionId: "session-1",
  question: { id: "question-1", code: "OPS-01", prompt: "Are user access rights reviewed?" },
  answer: "no",
});

describe("generateAiSuggestion", () => {
  it("requires a structured draft and filters model-invented source references", async () => {
    const provider: AiProvider = {
      generate: async () => JSON.stringify({
        explanation: "Access reviews reduce the chance that former staff retain access.",
        recommendedAction: "Assign an access-review owner and record a monthly review.",
        confidence: "medium",
        sourceReferences: [
          { type: "assessment_question", id: "question-1", label: "OPS-01" },
          { type: "evidence", id: "secret-file", label: "Invented record" },
        ],
      }),
    };

    await expect(generateAiSuggestion({ provider, context })).resolves.toEqual({
      explanation: "Access reviews reduce the chance that former staff retain access.",
      recommendedAction: "Assign an access-review owner and record a monthly review.",
      confidence: "medium",
      sourceReferences: [{ type: "assessment_question", id: "question-1", label: "OPS-01" }],
    });
  });

  it("gives the provider source data as data and prohibits autonomous compliance decisions", async () => {
    let request = "";
    const provider: AiProvider = { generate: async (input) => { request = input; return JSON.stringify({ explanation: "Explain", recommendedAction: "Review", confidence: "low", sourceReferences: [] }); } };

    await generateAiSuggestion({ provider, context });

    expect(request).toMatch(/draft only/i);
    expect(request).toMatch(/must not mark.*compliant/i);
    expect(request).toMatch(/UNTRUSTED WORKSPACE DATA/i);
    expect(request).toContain("OPS-01");
  });
});
