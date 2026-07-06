import { z } from "zod";

// Owner-managed external evidence source (mirrors connectionInputSchema). The
// provider drives which config fields apply; all are optional at dev time because
// the FAKE collector needs no real settings. The access token is optional in
// sandbox mode and is NEVER read back by any page.
export const evidenceSourceInputSchema = z.object({
  provider: z.enum(["google_workspace", "github", "aws"]),
  label: z.string().trim().max(160).default(""),
  // Google Workspace: domain. GitHub: owner + repo. AWS: account + region.
  domain: z.string().max(300).default(""),
  owner: z.string().max(120).default(""),
  repo: z.string().max(120).default(""),
  account: z.string().max(120).default(""),
  region: z.string().max(60).default(""),
  accessToken: z.string().max(4000).default(""),
});
export type EvidenceSourceInput = z.infer<typeof evidenceSourceInputSchema>;
