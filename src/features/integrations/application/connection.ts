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
}).refine((v) => {
  // The Jira baseUrl becomes an outbound fetch target in the sync (jira.ts), so it
  // must be locked to Atlassian Cloud (https://<domain>.atlassian.net). Without
  // this an owner could point it at an internal host / link-local IP and turn the
  // sync into a server-side request forge (SSRF). GitHub uses a fixed host already.
  if (v.provider !== "jira" || !v.baseUrl) return true;
  try {
    const u = new URL(v.baseUrl);
    return u.protocol === "https:" && (u.hostname === "atlassian.net" || u.hostname.endsWith(".atlassian.net"));
  } catch { return false; }
}, { message: "Jira base URL must be an https://<your-domain>.atlassian.net address", path: ["baseUrl"] });
export type ConnectionInput = z.infer<typeof connectionInputSchema>;
