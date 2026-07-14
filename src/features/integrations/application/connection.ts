import { z } from "zod";

function isAtlassianCloudUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === ""
      && url.port === "" && url.pathname === "/" && url.search === "" && url.hash === ""
      && url.hostname.endsWith(".atlassian.net");
  } catch {
    return false;
  }
}

const githubOwnerSchema = z.string().trim().min(1, "GitHub owner is required").max(39)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/, "GitHub owner contains unsupported characters");
const githubRepoSchema = z.string().trim().min(1, "GitHub repository is required").max(100)
  .regex(/^[A-Za-z0-9._-]+$/, "GitHub repository contains unsupported characters")
  .refine((value) => value !== "." && value !== "..", "GitHub repository must not be a dot path");

export const connectionInputSchema = z.object({
  provider: z.enum(["jira", "github"]),
  label: z.string().trim().max(160).default(""),
  // Jira: baseUrl + projectKey. GitHub: owner + repo. All optional at dev time.
  baseUrl: z.string().max(300).default(""),
  projectKey: z.string().max(80).default(""),
  owner: z.string().max(120).default(""),
  repo: z.string().max(120).default(""),
  accessToken: z.string().max(4000).default(""),
}).refine((v) => {
  // The Jira baseUrl becomes an outbound fetch target in the sync (jira.ts), so it
  // must be locked to Atlassian Cloud (https://<domain>.atlassian.net). Without
  // this an owner could point it at an internal host / link-local IP and turn the
  // sync into a server-side request forge (SSRF). GitHub uses a fixed host already.
  if (v.provider !== "jira" || !v.baseUrl) return true;
  return isAtlassianCloudUrl(v.baseUrl);
}, { message: "Jira base URL must be an https://<your-domain>.atlassian.net address", path: ["baseUrl"] });
export type ConnectionInput = z.infer<typeof connectionInputSchema>;

export const githubConnectionTargetSchema = z.object({
    provider: z.literal("github"),
    owner: githubOwnerSchema,
    repo: githubRepoSchema,
  });
export const jiraConnectionTargetSchema = z.object({
    provider: z.literal("jira"),
    baseUrl: z.string().trim().min(1, "Jira base URL is required").max(300)
      .refine(isAtlassianCloudUrl, "Jira base URL must be an Atlassian Cloud HTTPS URL"),
    projectKey: z.string().trim().min(1, "Jira project key is required").max(80)
      .regex(/^[A-Z][A-Z0-9_]*$/, "Jira project key must use uppercase letters, numbers, or underscores"),
  });
export const connectionTargetInputSchema = z.discriminatedUnion("provider", [
  githubConnectionTargetSchema,
  jiraConnectionTargetSchema,
]);
export type ConnectionTargetInput = z.infer<typeof connectionTargetInputSchema>;
