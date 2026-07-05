import { z } from "zod";
import { ASSET_CLASSIFICATION_LABEL, ASSET_VALUE_LABEL } from "@/features/assets/domain/assets";
import { textField, enumField, dateField, type TargetField, type ImportAdapter } from "../mapping";

export const ASSET_IMPORT_FIELDS: TargetField[] = [
  textField("reference", "Asset Reference", false, ["Reference"], 40),
  textField("description", "Asset Description", true, ["Description"], 200),
  textField("categoryName", "Category", false, [], 120),
  textField("ownerLocation", "Owner & Location", false, ["Owner", "Location"], 200),
  enumField("classification", "Classification", true, [], ASSET_CLASSIFICATION_LABEL),
  enumField("valueCriticality", "Value (Criticality)", true, ["Value", "Criticality"], ASSET_VALUE_LABEL),
  textField("securityControls", "Security Controls", false, []),
  textField("lifespan", "Asset Lifespan", false, ["Lifespan"], 120),
  dateField("lastUpdated", "Last Updated", false, []),
  textField("remarks", "Remarks", false, []),
];

export const assetRowSchema = z.object({
  reference: z.string().nullable(),
  description: z.string().min(1).max(200),
  categoryName: z.string().nullable(),
  ownerLocation: z.string().nullable(),
  classification: z.enum(["highly_confidential", "confidential", "internal_use_only", "public"]),
  valueCriticality: z.enum(["high", "medium", "low"]),
  securityControls: z.string().nullable(),
  lifespan: z.string().nullable(),
  lastUpdated: z.string().nullable(),
  remarks: z.string().nullable(),
});

export const assetAdapter: ImportAdapter = { module: "asset", label: "Asset inventory", fields: ASSET_IMPORT_FIELDS, rowSchema: assetRowSchema };
