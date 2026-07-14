import { z } from "zod";

export const createPolicyFeedbackSchema = z.object({
  policyId: z.uuid(),
  subject: z.string().trim().min(3).max(160),
  body: z.string().trim().min(1).max(4000),
});

export const replyPolicyFeedbackSchema = z.object({
  threadId: z.uuid(),
  body: z.string().trim().min(1).max(4000),
});

export const feedbackStatusSchema = z.object({
  threadId: z.uuid(),
  resolved: z.enum(["true", "false"]).transform((value) => value === "true"),
});
