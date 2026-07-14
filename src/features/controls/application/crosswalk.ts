import { z } from "zod";
import { COMPLIANCE_FRAMEWORKS } from "../domain/crosswalk";

export const crosswalkInputSchema = z.object({
  organisationId: z.uuid(),
  controlId: z.uuid(),
  framework: z.enum(COMPLIANCE_FRAMEWORKS),
  externalRef: z.string().trim().min(1).max(80),
  note: z.string().trim().min(1, "Rationale or interpretation is required").max(500),
});
export type CrosswalkInput = z.infer<typeof crosswalkInputSchema>;
