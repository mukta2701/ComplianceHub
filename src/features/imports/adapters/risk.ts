import { z } from "zod";
import { RISK_STATUS_LABEL } from "@/features/risks/domain/risks";
import { textField, enumField, intField, dateField, type TargetField } from "../mapping";

export type ImportModule = "risk" | "soa" | "asset";
export type ImportAdapter = { module: ImportModule; label: string; fields: TargetField[]; rowSchema: z.ZodType };

export const RISK_IMPORT_FIELDS: TargetField[] = [
  textField("reference", "Risk ID", false, ["Reference", "Risk No."], 40),
  textField("description", "Risk Description", true, ["Description"]),
  textField("categoryName", "Risk Category", true, ["Category"], 120),
  intField("likelihood", "Likelihood", true, ["Likelihood (Probability)"]),
  intField("impact", "Impact", true, ["Impact (Business Impact)"]),
  textField("treatmentPlan", "Mitigation Measures", false, ["Mitigation", "Treatment Plan"]),
  textField("ownerName", "Risk Owner", false, ["Owner"], 200),
  enumField("status", "Status", false, [], RISK_STATUS_LABEL),
  dateField("reviewDate", "Review Date", false, []),
];

// Importable-row shape (pre-resolution). Category/owner NAMES here; the server
// resolves them to ids and re-validates with riskInputSchema before insert.
export const riskRowSchema = z.object({
  reference: z.string().nullable(),
  description: z.string(),
  categoryName: z.string(),
  likelihood: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  treatmentPlan: z.string().nullable(),
  ownerName: z.string().nullable(),
  status: z.enum(["open", "treating", "accepted", "closed"]).nullable(),
  reviewDate: z.string().nullable(),
});

export const riskAdapter: ImportAdapter = { module: "risk", label: "Risk register", fields: RISK_IMPORT_FIELDS, rowSchema: riskRowSchema };
