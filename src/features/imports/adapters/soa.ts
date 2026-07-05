import { z } from "zod";
import { SOA_STATUS_LABEL } from "@/features/soa/domain/soa";
import { textField, enumField, boolField, type TargetField } from "../mapping";
import type { ImportAdapter } from "./risk";

// SoA items are generated from controls, never inserted — import UPDATES matched
// rows by controlCode within a selected register (applicability, status,
// justification, owner). Fields mirror the SoA export columns.
export const SOA_IMPORT_FIELDS: TargetField[] = [
  textField("controlCode", "Control Number", true, ["Control", "Control Code"], 40),
  boolField("applicable", "Is Control Applicable?", true, ["Applicable"]),
  textField("justification", "Justification for the Inclusion/Exclusion", true, ["Justification"]),
  enumField("status", "Implementation Status", true, ["Status"], SOA_STATUS_LABEL),
  textField("ownerName", "Owner", false, [], 200),
  textField("comments", "Comments", false, ["Evidence"]),
];

// Importable-row shape (pre-resolution). Owner as NAME here; the server resolves
// it to owner_id and re-validates with soaItemReviewSchema before update.
// Mirrors soaItemReviewSchema's refine: applicable ⇒ status ≠ not_applicable.
export const soaRowSchema = z.object({
  controlCode: z.string(),
  applicable: z.boolean(),
  justification: z.string().min(1),
  status: z.enum(["pending", "absent", "in_progress", "established", "operational", "advanced", "not_applicable"]),
  ownerName: z.string().nullable(),
  comments: z.string().nullable(),
}).refine((v) => (v.applicable ? v.status !== "not_applicable" : v.status === "not_applicable"), { message: "Status must match applicability" });

export const soaAdapter: ImportAdapter = { module: "soa", label: "Statement of Applicability", fields: SOA_IMPORT_FIELDS, rowSchema: soaRowSchema };
