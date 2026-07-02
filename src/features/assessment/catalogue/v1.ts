import type { AssessmentQuestion } from "../domain/types";

export const catalogueV1 = Object.freeze({
  id: "compliancehub-readiness-v1",
  version: 1,
  status: "draft_owner_review_required" as const,
  questions: Object.freeze<readonly AssessmentQuestion[]>([
    { id: "gov-01", category: "Governance", weight: 3, prompt: "Has senior leadership assigned clear accountability for information security?", remediation: "Name an accountable leader and document their responsibilities." },
    { id: "gov-02", category: "Governance", weight: 2, prompt: "Are information security objectives documented and reviewed regularly?", remediation: "Set measurable objectives and schedule management reviews." },
    { id: "risk-01", category: "Risk management", weight: 3, prompt: "Do you use a repeatable method to identify and assess information security risks?", remediation: "Document a risk assessment method and apply it to business assets and activities." },
    { id: "risk-02", category: "Risk management", weight: 3, prompt: "Are risk treatment decisions assigned to owners and tracked to completion?", remediation: "Create a treatment plan with owners, due dates, and acceptance criteria." },
    { id: "people-01", category: "People", weight: 2, prompt: "Do workers receive security guidance appropriate to their responsibilities?", remediation: "Introduce role-appropriate induction and refresher security learning." },
    { id: "access-01", category: "Access control", weight: 3, prompt: "Are access rights approved, reviewed, and removed promptly when no longer needed?", remediation: "Establish joiner, mover, leaver and periodic access-review workflows." },
    { id: "assets-01", category: "Asset management", weight: 2, prompt: "Can you identify the important information and technology assets your organisation relies on?", remediation: "Maintain an owned inventory of important information and technology assets." },
    { id: "supplier-01", category: "Suppliers", weight: 2, prompt: "Are security expectations considered before engaging suppliers that handle important information?", remediation: "Add proportionate security due diligence and contract requirements to supplier onboarding." },
    { id: "incident-01", category: "Incident management", weight: 3, prompt: "Can staff report suspected security incidents through a known and tested process?", remediation: "Publish reporting routes, response roles, and exercise the process." },
    { id: "continuity-01", category: "Resilience", weight: 3, prompt: "Have you tested recovery of the services and information needed for critical activities?", remediation: "Define recovery objectives and perform recorded restoration exercises." },
    { id: "ops-01", category: "Secure operations", weight: 2, prompt: "Are security updates assessed and applied within timeframes based on risk?", remediation: "Define patching targets, track exceptions, and report overdue updates." },
    { id: "improve-01", category: "Improvement", weight: 2, prompt: "Are security weaknesses and audit findings tracked through corrective action?", remediation: "Record causes, owners, corrective actions, and effectiveness checks." },
  ]),
});
