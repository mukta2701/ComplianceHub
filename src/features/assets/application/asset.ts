import { z } from "zod";

const optionalUuid = z.union([z.string().uuid(), z.literal("")]).optional().transform((v) => (v ? v : null));
const optionalDate = z.union([z.iso.date(), z.literal("")]).optional().transform((v) => (v ? v : null));

export const assetInputSchema = z.object({
  organisationId: z.string().uuid(),
  reference: z.string().trim().min(1).max(40),
  description: z.string().trim().min(1).max(200),
  ownerLocation: z.string().max(200).default(""),
  ownerId: optionalUuid,
  classification: z.enum(["highly_confidential", "confidential", "internal_use_only", "public"]),
  valueCriticality: z.enum(["high", "medium", "low"]),
  categoryId: optionalUuid,
  securityControls: z.string().max(10_000).default(""),
  lifespan: z.string().max(120).default(""),
  lastUpdated: optionalDate,
  remarks: z.string().max(10_000).default(""),
});
export type AssetInput = z.infer<typeof assetInputSchema>;
