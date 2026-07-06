import { z } from "zod";

const optionalUuid = z.union([z.string().uuid(), z.literal("")]).optional().transform((v) => (v ? v : null));
const optionalDate = z.union([z.iso.date(), z.literal("")]).optional().transform((v) => (v ? v : null));

export const kpiInputSchema = z.object({
  organisationId: z.string().uuid(),
  controlFunction: z.string().max(200).default(""),
  indicator: z.string().trim().min(1).max(300),
  measurementType: z.enum(["automatic", "manual", "external"]).default("manual"),
  threshold: z.string().max(500).default(""),
  observations: z.string().max(10_000).default(""),
  nextSteps: z.string().max(10_000).default(""),
  responsibleId: optionalUuid,
  lastReviewed: optionalDate,
});
export type KpiInput = z.infer<typeof kpiInputSchema>;
