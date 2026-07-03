import { z } from "zod";

const optionalUuid = z.union([z.string().uuid(), z.literal("")]).optional()
  .transform((value) => (value ? value : null));
const optionalDate = z.union([z.iso.date(), z.literal("")]).optional()
  .transform((value) => (value ? value : null));

export const taskInputSchema = z.object({
  organisationId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  detail: z.string().max(10_000).default(""),
  status: z.enum(["open", "in_progress", "done", "cancelled"]).default("open"),
  ownerId: optionalUuid,
  dueOn: optionalDate,
  recurrence: z.union([z.enum(["weekly", "monthly", "quarterly", "semiannually", "annually"]), z.literal("")]).optional()
    .transform((value) => (value ? value : null)),
  controlId: optionalUuid,
  riskId: optionalUuid,
});
export const gapTaskInputSchema = taskInputSchema.refine((value) => value.ownerId !== null && value.dueOn !== null, {
  message: "Gap tasks require an owner and due date",
});
export type TaskInput = z.infer<typeof taskInputSchema>;
