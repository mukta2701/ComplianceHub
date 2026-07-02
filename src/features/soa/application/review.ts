import { z } from "zod";

export const soaItemReviewSchema = z.object({
  itemId: z.string().uuid(), status: z.enum(["implemented", "partial", "planned", "not_applicable"]),
  applicable: z.boolean(), justification: z.string().trim().min(1).max(10_000), evidence: z.string().max(10_000).default(""),
}).refine((value) => value.applicable ? value.status !== "not_applicable" : value.status === "not_applicable", {
  message: "Status must match applicability", path: ["status"],
});
