import { describe, expect, it } from "vitest";
import { buildOnboardingChecklist } from "./checklist";

describe("buildOnboardingChecklist", () => {
  it("marks only 'create your workspace' done for a brand-new workspace", () => {
    const checklist = buildOnboardingChecklist({
      hasAssessment: false,
      hasPolicy: false,
      hasRisk: false,
      hasSoa: false,
      hasTeam: false,
    });
    expect(checklist.total).toBe(6);
    expect(checklist.doneCount).toBe(1);
    expect(checklist.percent).toBe(17); // round(1/6 * 100)
    expect(checklist.complete).toBe(false);
    // The workspace step is first and always done; the rest are actionable.
    expect(checklist.steps[0]).toMatchObject({ id: "workspace", done: true });
    expect(checklist.steps.filter((s) => s.done)).toHaveLength(1);
    // Every actionable step exposes a real route + CTA label.
    for (const step of checklist.steps.slice(1)) {
      expect(step.href.startsWith("/app")).toBe(true);
      expect(step.cta.length).toBeGreaterThan(0);
    }
  });

  it("counts a partially-activated workspace correctly", () => {
    const checklist = buildOnboardingChecklist({
      hasAssessment: true,
      hasPolicy: true,
      hasRisk: false,
      hasSoa: false,
      hasTeam: false,
    });
    // workspace + assessment + policy = 3 of 6.
    expect(checklist.doneCount).toBe(3);
    expect(checklist.total).toBe(6);
    expect(checklist.percent).toBe(50);
    expect(checklist.complete).toBe(false);
  });

  it("reports complete:true and 100% when every step is done", () => {
    const checklist = buildOnboardingChecklist({
      hasAssessment: true,
      hasPolicy: true,
      hasRisk: true,
      hasSoa: true,
      hasTeam: true,
    });
    expect(checklist.doneCount).toBe(6);
    expect(checklist.total).toBe(6);
    expect(checklist.percent).toBe(100);
    expect(checklist.complete).toBe(true);
  });

  it("adds the optional tracker step only when the signal is supplied", () => {
    const without = buildOnboardingChecklist({
      hasAssessment: true,
      hasPolicy: true,
      hasRisk: true,
      hasSoa: true,
      hasTeam: true,
    });
    expect(without.steps.some((s) => s.id === "integration")).toBe(false);

    const withStep = buildOnboardingChecklist({
      hasAssessment: true,
      hasPolicy: true,
      hasRisk: true,
      hasSoa: true,
      hasTeam: true,
      hasIntegration: false,
    });
    // The tracker step lands last and is still outstanding, so the all-else-done
    // workspace is NOT complete and the card stays visible.
    expect(withStep.total).toBe(7);
    expect(withStep.doneCount).toBe(6);
    expect(withStep.percent).toBe(86); // round(6/7 * 100)
    expect(withStep.complete).toBe(false);
    expect(withStep.steps[withStep.steps.length - 1]).toMatchObject({ id: "integration", done: false });

    const allDone = buildOnboardingChecklist({
      hasAssessment: true,
      hasPolicy: true,
      hasRisk: true,
      hasSoa: true,
      hasTeam: true,
      hasIntegration: true,
    });
    expect(allDone.total).toBe(7);
    expect(allDone.doneCount).toBe(7);
    expect(allDone.percent).toBe(100);
    expect(allDone.complete).toBe(true);
  });
});
