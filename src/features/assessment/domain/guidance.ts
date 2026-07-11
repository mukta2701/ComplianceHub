export type AssessmentGuidance = {
  whyItMatters: string;
  startupBaseline: string;
  evidenceExamples: string[];
};

const guidanceByCode: Record<string, AssessmentGuidance> = {
  "GOV-01": {
    whyItMatters: "Clear objectives help leaders turn security priorities into decisions that the team can understand, fund and review.",
    startupBaseline: "Write down a small set of security objectives, name an owner for each one, and record leadership approval and a review date.",
    evidenceExamples: ["Leadership meeting notes recording approval", "A security objectives document with owners and measures"],
  },
  "GOV-02": {
    whyItMatters: "Named responsibilities reduce missed work and make it clear who should make decisions or respond when an issue occurs.",
    startupBaseline: "List the important security responsibilities, assign each to a named role or person, and confirm that they understand what is expected.",
    evidenceExamples: ["A responsibility map or simple RACI record", "Role descriptions or onboarding notes covering security duties"],
  },
  "RISK-01": {
    whyItMatters: "A repeatable risk method helps the team compare concerns consistently and spend limited time and money on the most important issues.",
    startupBaseline: "Document a simple method for describing likelihood and impact, agree when a risk needs action, and use it for the current business scope.",
    evidenceExamples: ["A short risk assessment method approved by leadership", "Completed risk assessments using consistent likelihood and impact scales"],
  },
  "RISK-02": {
    whyItMatters: "Risks without owners or decisions tend to remain open, while clear ownership makes follow-up and trade-offs visible.",
    startupBaseline: "For each material risk, name one accountable owner and record whether it will be reduced, accepted, avoided or transferred, with a target date.",
    evidenceExamples: ["A risk register showing owners and treatment decisions", "Action records with target dates and review notes"],
  },
  "OPS-01": {
    whyItMatters: "Timely access changes limit the chance that former staff, changed roles or unnecessary privileged accounts can reach sensitive information.",
    startupBaseline: "Use one documented joiner, mover and leaver process, require approval for access, and review privileged and important accounts on a regular schedule.",
    evidenceExamples: ["Recent access approval and removal records", "A completed user and privileged access review"],
  },
  "OPS-02": {
    whyItMatters: "Backups only protect the business when important information can be restored within a useful timeframe after loss or disruption.",
    startupBaseline: "Identify the systems that need backups, set basic recovery expectations, monitor backup results, and complete a recorded restore test for a representative system.",
    evidenceExamples: ["Backup job reports and failure follow-up records", "A restore test record showing the result and lessons learned"],
  },
  "OPS-03": {
    whyItMatters: "Early reporting gives the team more time to contain a suspected incident and reduces uncertainty about who should respond.",
    startupBaseline: "Publish one easy reporting route, explain common warning signs during onboarding, and run a short exercise so staff can practise using it.",
    evidenceExamples: ["Incident reporting instructions shared with staff", "Attendance and notes from an awareness session or exercise"],
  },
  "ASSURE-01": {
    whyItMatters: "Checking how controls work in practice reveals weak or inconsistent operation before the business has to rely on them during a real event.",
    startupBaseline: "Choose the most important controls, name who will review them, set a proportionate schedule, and retain the result and any follow-up action.",
    evidenceExamples: ["A control review schedule with named reviewers", "Test results, review notes or security performance measures"],
  },
  "ASSURE-02": {
    whyItMatters: "A planned review by someone outside the work being checked can identify assumptions and gaps that the delivery team may overlook.",
    startupBaseline: "Create a risk-based review plan, choose reviewers who are not checking their own work, and record the scope, findings and agreed actions.",
    evidenceExamples: ["An internal review programme and completed review report", "Reviewer assignment records showing separation from the work reviewed"],
  },
  "ASSURE-03": {
    whyItMatters: "Tracking corrective work through verification helps prevent recurring problems and shows whether the original cause was actually addressed.",
    startupBaseline: "Record each corrective action with its cause, owner and due date, then ask someone to check effectiveness before marking it complete.",
    evidenceExamples: ["A corrective action log with owners and due dates", "Closure records containing an effectiveness check"],
  },
};

const fallbackGuidance: AssessmentGuidance = {
  whyItMatters: "Understanding this practice helps the business make a clear security decision and identify where follow-up work may be useful.",
  startupBaseline: "Start with a named owner, a simple documented approach, and a regular review that is proportionate to the size and needs of the business.",
  evidenceExamples: ["A dated record showing the approach, owner and latest review"],
};

export function getAssessmentGuidance(code: string): AssessmentGuidance {
  return guidanceByCode[code] ?? fallbackGuidance;
}
