import { z } from "zod";
import type { AutomationArea, AutomationProvider } from "../domain/baseline";

const providerSchema = z.enum(["google_workspace", "github", "aws", "jira", "linear"]);

export const automationSetupSchema = z.object({
  providers: z.array(providerSchema).max(5).default([]),
  identityOwnerId: z.string().uuid().or(z.string().min(1)),
  engineeringOwnerId: z.string().uuid().or(z.string().min(1)),
  cloudOwnerId: z.string().uuid().or(z.string().min(1)),
  complianceOwnerId: z.string().uuid().or(z.string().min(1)),
});

const providerDetails: Record<AutomationProvider, { area: AutomationArea; label: string; reads: string }> = {
  google_workspace: { area: "identity", label: "Google Workspace", reads: "admin security posture and selected Drive compliance folders" },
  github: { area: "engineering", label: "GitHub", reads: "selected repository settings, review metadata, alerts and policy documents" },
  aws: { area: "cloud", label: "AWS", reads: "Security Hub and configuration findings through a read-only role" },
  jira: { area: "compliance", label: "Jira", reads: "selected issue status, ownership and attachments" },
  linear: { area: "compliance", label: "Linear", reads: "selected issue status, ownership and attachments" },
};

const areaOwner = (input: z.infer<typeof automationSetupSchema>, area: AutomationArea) => {
  if (area === "identity") return input.identityOwnerId;
  if (area === "engineering") return input.engineeringOwnerId;
  if (area === "cloud") return input.cloudOwnerId;
  return input.complianceOwnerId;
};

export function buildSetupSelections(input: z.infer<typeof automationSetupSchema>) {
  const providers = [...new Set(input.providers)];
  return {
    assignments: (["identity", "engineering", "cloud", "compliance"] as const).map((area) => ({ area, ownerId: areaOwner(input, area) })),
    connections: providers.map((provider) => {
      const details = providerDetails[provider];
      return {
        provider,
        area: details.area,
        label: details.label,
        ownerId: areaOwner(input, details.area),
        consent: { version: 1, contentAnalysis: true, reads: details.reads, retentionDays: 30 },
      };
    }),
  };
}

export const automationProviderDetails = providerDetails;
