import { z } from "zod";

const optionalUuid = z.union([z.uuid(), z.literal("")]).optional().transform((v) => (v ? v : null));
const optionalDate = z.union([z.iso.date(), z.literal("")]).optional().transform((v) => (v ? v : null));

export const rtpInputSchema = z.object({
  organisationId: z.uuid(),
  riskId: z.uuid(),
  reference: z.string().trim().min(1).max(40),
  summary: z.string().max(2000).default(""),
  treatmentMeasures: z.string().max(10_000).default(""),
  controlId: optionalUuid,
  assignedLeadId: optionalUuid,
  targetCompletion: optionalDate,
  status: z.enum(["planned", "in_progress", "completed", "cancelled"]).default("planned"),
  spawnTask: z.union([z.literal("on"), z.literal("")]).optional().transform((v) => v === "on"),
});
export type RtpInput = z.infer<typeof rtpInputSchema>;
