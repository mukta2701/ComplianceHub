// First-run onboarding checklist — a pure domain module (NOT "use server").
// It takes the RLS-scoped counts the dashboard already gathers and folds them
// into an ordered list of activation steps plus the done/total/percent roll-up.
// Keeping it here (off the page) lets the done-count and percent maths be
// unit-tested without a database or a rendered page.

export type OnboardingStep = {
  id: string;
  label: string;
  // Why the step matters / what it unlocks — shown under the label when actionable.
  description: string;
  // Where the call-to-action sends a new owner.
  href: string;
  cta: string;
  done: boolean;
};

// Booleans derived from head/count queries on the workspace's own rows. Every
// flag except the workspace one is optional so a caller can omit a signal (it
// then reads as "not done yet"). "Create your workspace" is implicit — anyone
// seeing the dashboard has already done it — so it is not an input.
export type OnboardingInputs = {
  hasAssessment: boolean;
  hasPolicy: boolean;
  hasRisk: boolean;
  hasSoa: boolean;
  hasEvidence: boolean;
  hasAsset: boolean;
  hasTask: boolean;
  hasTeam: boolean;
  // Optional, last, non-blocking-feeling "power" step. Present only when the
  // workspace has an active tracker connection.
  hasIntegration?: boolean;
};

export type OnboardingChecklist = {
  steps: OnboardingStep[];
  doneCount: number;
  total: number;
  percent: number;
  // True once every step is done — the dashboard uses this to auto-hide the
  // card so established workspaces never see it (no "dismissed" persistence).
  complete: boolean;
};

export function buildOnboardingChecklist(inputs: OnboardingInputs): OnboardingChecklist {
  const steps: OnboardingStep[] = [
    {
      id: "workspace",
      label: "Create your workspace",
      description: "Your private workspace for the compliance programme.",
      href: "/app",
      cta: "Done",
      done: true,
    },
    {
      id: "assessment",
      label: "Start your first readiness assessment",
      description: "Answer the readiness questions to see your gaps and prepare your control plan.",
      href: "/app/assessment",
      cta: "Start assessment",
      done: inputs.hasAssessment,
    },
    {
      id: "soa",
      label: "Generate your Statement of Applicability",
      description: "Turn the assessment into a control-by-control SoA register.",
      href: "/app/soa",
      cta: "Open SoA",
      done: inputs.hasSoa,
    },
    {
      id: "asset",
      label: "Record a critical asset",
      description: "Capture a system, service or information asset the company depends on.",
      href: "/app/assets/new",
      cta: "Add asset",
      done: inputs.hasAsset,
    },
    {
      id: "risk",
      label: "Add your first risk",
      description: "Record the risk, its impact and what you will do about it.",
      href: "/app/risks/new",
      cta: "Add risk",
      done: inputs.hasRisk,
    },
    {
      id: "task",
      label: "Create your first task",
      description: "Give compliance work a clear owner and status so it can move forward.",
      href: "/app/tasks/new",
      cta: "Add task",
      done: inputs.hasTask,
    },
    {
      id: "evidence",
      label: "Attach your first evidence",
      description: "Link proof to a control — freshness is then tracked automatically.",
      href: "/app/evidence/new",
      cta: "Add evidence",
      done: inputs.hasEvidence,
    },
    {
      id: "policy",
      label: "Create your first policy",
      description: "Start from a template, then review and publish it when it is ready.",
      href: "/app/policies/new",
      cta: "New policy",
      done: inputs.hasPolicy,
    },
    {
      id: "team",
      label: "Invite a teammate",
      description: "Bring in the people who own or contribute to compliance work.",
      href: "/app/settings",
      cta: "Invite the team",
      done: inputs.hasTeam,
    },
  ];

  // Optional final "connect a tracker" step — only offered when the signal is
  // provided, so the core checklist stays seven steps for workspaces that never
  // wire up integrations.
  if (inputs.hasIntegration !== undefined) {
    steps.push({
      id: "integration",
      label: "Connect a tracker",
      description: "Push remediation tasks to Jira or GitHub Issues and sync status back.",
      href: "/app/integrations",
      cta: "Connect a tracker",
      done: inputs.hasIntegration,
    });
  }

  const total = steps.length;
  const doneCount = steps.reduce((sum, step) => sum + (step.done ? 1 : 0), 0);
  const percent = total === 0 ? 0 : Math.round((doneCount / total) * 100);
  return { steps, doneCount, total, percent, complete: doneCount === total };
}
