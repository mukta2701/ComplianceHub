import type { SoaStatus } from "@/features/soa/domain/soa";

type ReviewItem = {
  applicable: boolean;
  status: SoaStatus;
  ownerId: string | null;
  evidence: string;
};

export function summariseSoaReview(items: readonly ReviewItem[]) {
  const applicable = items.filter((item) => item.applicable);
  return {
    total: items.length,
    applicable: applicable.length,
    needsReview: applicable.filter((item) => item.status === "pending").length,
    evidenceMissing: applicable.filter((item) => item.evidence.trim() === "").length,
    ownerMissing: applicable.filter((item) => !item.ownerId).length,
  };
}

function themeForControl(code: string) {
  if (code.startsWith("5.")) return "Organisational controls establish clear governance, responsibilities, and operating practices.";
  if (code.startsWith("6.")) return "People controls make sure staff, contractors, and role changes are handled securely.";
  if (code.startsWith("7.")) return "Physical controls protect locations, equipment, and information stored outside software systems.";
  return "Technology controls help the organisation configure, operate, and monitor systems securely.";
}

export function getSoaControlGuidance(control: { code: string; title: string; applicable: boolean }) {
  const evidenceExamples = control.code === "8.5"
    ? ["Identity-provider configuration export", "MFA enforcement report", "Access review record"]
    : ["Approved policy or procedure", "Current operational record", "Review or test result"];
  const decision = control.applicable
    ? "Record why this control applies to your scope, risks, contracts, or technology, then describe the current implementation and evidence."
    : "Record the scope-based reason this control does not apply. Exclusions need the same level of care as applicable controls.";
  return {
    why: `${themeForControl(control.code)} ${control.title} is part of the control set your organisation needs to assess.`,
    evidenceExamples,
    decision,
    rationaleTemplate: control.applicable
      ? "This control is applicable because [scope, risk, contractual, or technology reason]. Current implementation is [status]. Supporting evidence is [reference]. This draft requires human review before save."
      : "This control is not applicable because [documented scope reason]. This draft requires human review before save.",
  };
}
