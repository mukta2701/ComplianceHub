import { z } from "zod";

const rating = z.coerce.number().int().min(1).max(5);
export const riskInputSchema = z.object({
  organisationId: z.string().uuid(), reference: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(10_000),
  categoryId: z.string().uuid(), ownerId: z.string().uuid().nullable().optional(),
  likelihood: rating, impact: rating, treatment: z.enum(["mitigate", "avoid", "transfer", "accept"]),
  treatmentPlan: z.string().max(10_000).default(""), residualLikelihood: rating, residualImpact: rating,
  reviewDate: z.union([z.iso.date(), z.literal("")]).optional(), status: z.enum(["open", "treating", "accepted", "closed"]),
  evidence: z.string().max(10_000).default(""), sourceAssessmentSessionId: z.string().uuid().nullable().optional(),
  sourceSoaRegisterId: z.string().uuid().nullable().optional(),
});
