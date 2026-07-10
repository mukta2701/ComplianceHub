export type ModuleKey = "assessment" | "scope" | "risks" | "assets" | "soa" | "evidence" | "policies" | "audits" | "kpis";

type GlossaryTerm = { term: string; definition: string };

export type ModuleGuidance = {
  why: string;
  decision: string;
  outcome: string;
  nextStep: string;
  terms: readonly GlossaryTerm[];
};

export type AssessmentQuestionGuidance = {
  why: string;
  evidenceExamples: readonly string[];
  answerHelp: {
    yes: string;
    partially: string;
    no: string;
    notApplicable: string;
  };
};

const assessmentAnswers = {
  yes: "The practice is in place, works consistently, and you can point to current evidence.",
  partially: "Some of the practice exists, but it is incomplete, inconsistent, or not yet supported by evidence.",
  no: "The practice is not currently in place. This is useful input for a risk, task, or control plan.",
  notApplicable: "The practice is genuinely outside the documented scope of your organisation. Record a scope-based reason before relying on this answer.",
} as const;

const moduleGuidance: Record<ModuleKey, ModuleGuidance> = {
  assessment: {
    why: "A readiness assessment creates a truthful baseline of how your organisation works today. It is not an exam or a certification result.",
    decision: "Answer based on current practice and add the evidence or uncertainty you have.",
    outcome: "You will see which areas are implemented, partial, missing, or need further investigation.",
    nextStep: "Partial, missing, or unclear answers can become a risk, a remediation task, or an evidence request.",
    terms: [
      { term: "Evidence", definition: "Proof that a control exists and is being operated, such as an approval record, system report, or review minutes." },
      { term: "Control", definition: "A safeguard or working practice that reduces information-security risk." },
    ],
  },
  scope: {
    why: "Scope makes the boundary of your ISMS clear: what the organisation is protecting, where it operates, and which dependencies matter.",
    decision: "Describe the services, people, locations, information, suppliers, and exclusions that belong inside the ISMS boundary.",
    outcome: "You will have a reviewable foundation for assessment answers, SoA applicability, risk decisions, and internal-audit planning.",
    nextStep: "Use the documented boundary when deciding whether controls apply and when planning audits.",
    terms: [{ term: "ISMS scope", definition: "The documented organisational boundary covered by your information-security management system." }],
  },
  risks: {
    why: "The risk register turns a weakness or uncertainty into a clear view of possible business harm and the action needed to reduce it.",
    decision: "Describe what could happen, score its likelihood and impact, then choose a treatment and owner.",
    outcome: "You will have a documented treatment decision that can be tracked and reviewed.",
    nextStep: "Link the treatment to controls, tasks, evidence, and the Statement of Applicability.",
    terms: [
      { term: "Inherent risk", definition: "The level of risk before safeguards are considered." },
      { term: "Residual risk", definition: "The level of risk that remains after safeguards are considered." },
    ],
  },
  assets: {
    why: "You cannot protect information consistently until you know what is valuable, where it is held, and who owns it.",
    decision: "Record the asset, its classification, criticality, owner, and the risks that threaten it.",
    outcome: "You will have an inventory that connects business information to security decisions.",
    nextStep: "Use the inventory when assessing risks, scope, controls, and evidence needs.",
    terms: [{ term: "Asset", definition: "Information, systems, devices, services, or records your organisation needs to protect." }],
  },
  soa: {
    why: "The Statement of Applicability records which controls apply to your organisation, why they apply, how they are implemented, and where proof is held.",
    decision: "For each control, make a defensible applicability, ownership, status, and evidence decision.",
    outcome: "You will have an audit-ready explanation of the controls in scope and their implementation state.",
    nextStep: "Use gaps in the SoA to create tasks, gather evidence, and prepare for audit preflight.",
    terms: [
      { term: "Applicable", definition: "The control is relevant to your documented scope, risks, legal duties, contracts, or technology." },
      { term: "Justification", definition: "The recorded reason for an applicability or exclusion decision." },
    ],
  },
  evidence: {
    why: "Evidence lets you demonstrate that a control is operating rather than merely documented.",
    decision: "Attach current proof to the control, risk, or task it supports and set an appropriate review date.",
    outcome: "You will have an evidence trail that can be reviewed for freshness and completeness.",
    nextStep: "Replace stale evidence and link strong evidence back to the relevant control and SoA item.",
    terms: [{ term: "Freshness", definition: "Whether evidence is recent enough to support the control at the required review interval." }],
  },
  policies: {
    why: "Policies establish the organisation's agreed security expectations and responsibilities.",
    decision: "Draft, review, approve, and communicate the policy to the people who need to follow it.",
    outcome: "You will have approved, versioned policy evidence and acceptance records.",
    nextStep: "Link the policy to controls and review it when working practices change.",
    terms: [{ term: "Approval", definition: "A documented leadership decision that a policy is ready to be used." }],
  },
  audits: {
    why: "Internal audits test whether the ISMS is operating as intended before an external auditor reviews it.",
    decision: "Plan the scope, collect objective evidence, record findings, and assign corrective actions.",
    outcome: "You will have a defensible audit trail and tracked corrective actions.",
    nextStep: "Use findings in management review and audit preflight.",
    terms: [{ term: "Non-conformity", definition: "A requirement or agreed process that is not being met." }],
  },
  kpis: {
    why: "KPIs help leadership judge whether the ISMS is working and where it needs attention.",
    decision: "Choose a meaningful measure, target, owner, review date, and response when performance changes.",
    outcome: "You will have management-review evidence based on measured performance rather than impressions.",
    nextStep: "Turn concerning trends into owned tasks, risks, or management-review actions.",
    terms: [{ term: "Management review", definition: "A leadership review of ISMS performance, risks, objectives, and improvement actions." }],
  },
};

const questionGuidance: Record<string, Pick<AssessmentQuestionGuidance, "why" | "evidenceExamples">> = {
  "OPS-01": {
    why: "Access that is not approved, reviewed, and removed promptly can leave former staff or contractors able to reach company systems and customer information.",
    evidenceExamples: ["Access-control policy", "Recent access review record", "Joiner, mover, and leaver checklist"],
  },
  "OPS-02": {
    why: "Backups only reduce risk when they can be restored within the time your organisation needs to recover.",
    evidenceExamples: ["Backup configuration report", "Recent restoration test record", "Recovery procedure"],
  },
  "OPS-03": {
    why: "Early reporting helps contain incidents before they affect customers, operations, or legal obligations.",
    evidenceExamples: ["Incident response procedure", "Security training record", "Recent tabletop exercise notes"],
  },
  "RISK-01": {
    why: "A repeatable risk method helps people make security decisions consistently and explain why controls were chosen.",
    evidenceExamples: ["Risk methodology", "Current risk register", "Risk appetite or treatment criteria"],
  },
  "RISK-02": {
    why: "Risks need a named owner and a treatment decision so important exposure does not remain an untracked concern.",
    evidenceExamples: ["Risk register", "Risk treatment plan", "Management approval or review record"],
  },
  "GOV-01": {
    why: "Leadership-approved objectives show that security has direction, ownership, and resources beyond day-to-day technical work.",
    evidenceExamples: ["Security objectives", "Leadership meeting minutes", "Approved security policy"],
  },
  "GOV-02": {
    why: "Clear responsibilities make it possible to operate controls consistently and show who is accountable when something needs attention.",
    evidenceExamples: ["Responsibility matrix", "Role descriptions", "Policy ownership record"],
  },
  "ASSURE-01": {
    why: "Checking controls in practice helps discover when a documented process has drifted or stopped working.",
    evidenceExamples: ["Control review plan", "Review records", "Test or monitoring results"],
  },
  "ASSURE-02": {
    why: "Internal audits provide independent evidence that the ISMS is working before external audit or customer review.",
    evidenceExamples: ["Internal audit schedule", "Audit checklist", "Completed audit report"],
  },
  "ASSURE-03": {
    why: "Corrective actions only improve the ISMS when they are owned, completed, and checked for effectiveness.",
    evidenceExamples: ["Corrective action register", "Task completion evidence", "Follow-up review record"],
  },
};

export function getModuleGuidance(module: ModuleKey): ModuleGuidance {
  return moduleGuidance[module];
}

export function getAssessmentQuestionGuidance(question: { code: string; prompt: string }): AssessmentQuestionGuidance {
  const matched = questionGuidance[question.code];
  return {
    why: matched?.why ?? `This question helps establish whether ${question.prompt.charAt(0).toLowerCase()}${question.prompt.slice(1)}`,
    evidenceExamples: matched?.evidenceExamples ?? ["Relevant policy or procedure", "Current operational record", "Named owner or review record"],
    answerHelp: assessmentAnswers,
  };
}
