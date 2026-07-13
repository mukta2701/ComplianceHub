import { z } from "zod";
import { COMPLIANCE_FRAMEWORKS } from "../domain/crosswalk";

export const crosswalkInputSchema = z.object({
  organisationId: z.uuid(),
  controlId: z.uuid(),
  framework: z.enum(COMPLIANCE_FRAMEWORKS),
  externalRef: z.string().trim().min(1).max(80),
  note: z.string().trim().max(500).optional().transform((v) => (v ? v : null)),
});
export type CrosswalkInput = z.infer<typeof crosswalkInputSchema>;
