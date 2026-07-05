import type { SoaExportView } from "./export";
import { SOA_STATUS_LABEL, type SoaStatus } from "../domain/soa";

const items: readonly [string, SoaStatus, string][] = [
  ["A.5.1", "operational", "Annual policy review is owned by the security lead."],
  ["A.5.2", "operational", "Responsibilities are recorded in role descriptions."],
  ["A.5.7", "pending", "A proportionate monitoring process will be introduced."],
  ["A.5.19", "in_progress", "New suppliers are checked; annual reviews are being added."],
  ["A.6.3", "in_progress", "Induction exists; role-specific refreshers are planned."],
  ["A.7.2", "operational", "Managed access controls protect the office."],
  ["A.8.5", "operational", "MFA is enforced for cloud and administrative systems."],
  ["A.8.8", "pending", "Patch targets need formal approval and reporting."],
  ["A.8.13", "in_progress", "Backups run daily; restore testing is overdue."],
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
    statusLabel: SOA_STATUS_LABEL[status],
    justification,
    evidence: "Demonstration data",
  })),
};
