import { z } from "zod";

const optionalUuid = z.union([z.uuid(), z.literal("")]).optional().transform((v) => (v ? v : null));
const optionalDate = z.union([z.iso.date(), z.literal("")]).optional().transform((v) => (v ? v : null));

export const policyInputSchema = z.object({
  organisationId: z.uuid(),
  reference: z.string().trim().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(100_000).default(""),
  ownerId: optionalUuid,
  reviewDue: optionalDate,
});
export type PolicyInput = z.infer<typeof policyInputSchema>;
