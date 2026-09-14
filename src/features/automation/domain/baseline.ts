export type AutomationProvider = "google_workspace" | "github" | "aws" | "jira" | "linear";
export type AutomationArea = "identity" | "engineering" | "cloud" | "compliance";
export type AutomationConfidence = "low" | "medium" | "high";
export type BaselineState = "confirmed" | "needs_review" | "not_detected";
export type ProposalTarget = "evidence" | "scope_fact" | "assessment_answer" | "soa_rationale" | "risk" | "task";

export type EvidenceObservation = {
  provider: AutomationProvider;
  externalRef: string;
  title: string;
  summary: string;
  sourceUrl?: string;
  occurredAt: string;
};

export type AutomationSignal = EvidenceObservation & {
  type: string;
  area: AutomationArea;
  confidence: AutomationConfidence;
};

export type BaselineProposal = {
  targetType: ProposalTarget;
  area: AutomationArea;
  state: BaselineState;
  title: string;
  why: string;
  recommendedAction: string;
};

const SIGNALS: Record<string, Pick<AutomationSignal, "type" | "area" | "confidence">> = {
  "github:branch protection settings": { type: "github.branch_protection", area: "engineering", confidence: "high" },
  "github:dependabot alerts summary": { type: "github.security_alerts", area: "engineering", confidence: "medium" },
  "google_workspace:mfa enforcement report": { type: "google_workspace.mfa_enforcement", area: "identity", confidence: "high" },
  "google_workspace:access review export": { type: "google_workspace.access_review", area: "identity", confidence: "medium" },
  "aws:security hub findings": { type: "aws.security_hub_findings", area: "cloud", confidence: "high" },
  "aws:s3 encryption configuration": { type: "aws.storage_encryption", area: "cloud", confidence: "medium" },
};

const DEFAULT_AREA: Record<AutomationProvider, AutomationArea> = {
  google_workspace: "identity",
  github: "engineering",
  aws: "cloud",
  jira: "compliance",
  linear: "compliance",
};

export function normaliseEvidenceSignal(observation: EvidenceObservation): AutomationSignal {
  const known = SIGNALS[`${observation.provider}:${observation.title.toLowerCase()}`];
  return {
    ...observation,
    ...(known ?? {
      type: `${observation.provider}.unclassified`,
      area: DEFAULT_AREA[observation.provider],
      confidence: "low" as const,
    }),
  };
}

export function buildBaselineProposal(signal: AutomationSignal): BaselineProposal {
  if (signal.type === "github.branch_protection") {
    return {
      targetType: "evidence",
      area: "engineering",
      state: "needs_review",
      title: "Review GitHub branch protection evidence",
      why: "Protected branches support controlled software changes, but a reviewer must confirm that the selected repositories are in scope.",
      recommendedAction: "Accept this source as evidence or create a remediation task for repositories that still need protection.",
    };
  }
  if (signal.type === "aws.security_hub_findings") {
    return {
      targetType: "task",
      area: "cloud",
      state: "needs_review",
      title: "Review AWS Security Hub findings",
      why: "Cloud findings can indicate a control gap, but the team must verify applicability and remediation priority.",
      recommendedAction: "Create a draft remediation task for the failed findings after reviewing the affected resources.",
    };
  }
  return {
    targetType: "evidence",
    area: signal.area,
    state: "needs_review",
    title: `Review ${signal.title}`,
    why: "This connected-system observation may support your readiness baseline, but it has not been accepted as evidence.",
    recommendedAction: "Review the source, then accept it as evidence, use it as a draft, or dismiss it.",
  };
}
