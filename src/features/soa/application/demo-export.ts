import type { SoaExportView } from "./export";

const statuses = {
  implemented: "Implemented",
  partial: "Partially implemented",
  planned: "Planned",
  not_applicable: "Not applicable",
} as const;

type DemoStatus = keyof typeof statuses;

const items: readonly [string, DemoStatus, string][] = [
  ["A.5.1", "implemented", "Annual policy review is owned by the security lead."],
  ["A.5.2", "implemented", "Responsibilities are recorded in role descriptions."],
  ["A.5.7", "planned", "A proportionate monitoring process will be introduced."],
  ["A.5.19", "partial", "New suppliers are checked; annual reviews are being added."],
  ["A.6.3", "partial", "Induction exists; role-specific refreshers are planned."],
  ["A.7.2", "implemented", "Managed access controls protect the office."],
  ["A.8.5", "implemented", "MFA is enforced for cloud and administrative systems."],
  ["A.8.8", "planned", "Patch targets need formal approval and reporting."],
  ["A.8.13", "partial", "Backups run daily; restore testing is overdue."],
  ["A.8.23", "not_applicable", "No managed network or corporate endpoint fleet."],
];

export const demoSoaExport: SoaExportView = {
  title: "Statement of Applicability",
  organisationName: "Northstar Labs",
  catalogueVersion: "ComplianceHub readiness catalogue v1",
  version: 1,
  assessmentId: "demo-assessment",
  finalisedAt: "2026-07-02T00:00:00.000Z",
  finalisedBy: "Priya Shah",
  items: items.map(([reference, status, justification]) => ({
    reference,
    status,
    statusLabel: statuses[status],
    justification,
    evidence: "Demonstration data",
  })),
};
