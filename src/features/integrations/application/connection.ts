import { z } from "zod";

export const connectionInputSchema = z.object({
  provider: z.enum(["jira", "github"]),
  label: z.string().trim().max(160).default(""),
  // Jira: baseUrl + projectKey. GitHub: owner + repo. All optional at dev time.
  baseUrl: z.string().max(300).default(""),
  projectKey: z.string().max(80).default(""),
  owner: z.string().max(120).default(""),
  repo: z.string().max(120).default(""),
  accessToken: z.string().max(4000).default(""),
});
export type ConnectionInput = z.infer<typeof connectionInputSchema>;
