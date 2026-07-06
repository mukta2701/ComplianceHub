import { z } from "zod";

const optionalUuid = z.union([z.string().uuid(), z.literal("")]).optional().transform((v) => (v ? v : null));
const optionalDate = z.union([z.iso.date(), z.literal("")]).optional().transform((v) => (v ? v : null));

export const auditInputSchema = z.object({
  organisationId: z.string().uuid(),
  reference: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  scope: z.string().max(10_000).default(""),
  leadAuditorId: optionalUuid,
  plannedStart: optionalDate,
  plannedEnd: optionalDate,
  framework: z.string().trim().min(1).max(120).default("ISO 27001:2022"),
});
export type AuditInput = z.infer<typeof auditInputSchema>;

export const checklistItemInputSchema = z.object({
  auditId: z.string().uuid(),
  area: z.string().max(200).default(""),
  clauseReference: z.string().max(40).default(""),
  checklistItem: z.string().trim().min(1).max(2000),
  controlId: optionalUuid,
  compliant: z.enum(["compliant", "non_compliant", "not_applicable", "not_tested"]).default("not_tested"),
  evidenceNote: z.string().max(10_000).default(""),
  findings: z.string().max(10_000).default(""),
  responsibleId: optionalUuid,
  reviewedOn: optionalDate,
});
export type ChecklistItemInput = z.infer<typeof checklistItemInputSchema>;

export const findingInputSchema = z.object({
  auditId: z.string().uuid(),
  checklistItemId: optionalUuid,
  summary: z.string().trim().min(1).max(2000),
  severity: z.enum(["observation", "minor_nc", "major_nc"]).default("observation"),
  rootCause: z.string().max(10_000).default(""),
  correctiveAction: z.string().max(10_000).default(""),
  ownerId: optionalUuid,
  dueOn: optionalDate,
  spawnTask: z.union([z.literal("on"), z.literal("")]).optional().transform((v) => v === "on"),
});
export type FindingInput = z.infer<typeof findingInputSchema>;
