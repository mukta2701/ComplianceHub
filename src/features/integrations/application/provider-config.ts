import "server-only";
import { siteUrl } from "@/lib/site-url";

export type JiraProviderConfig = { clientId: string; clientSecret: string; callbackUrl: string };
export function getJiraProviderConfig(): JiraProviderConfig {
  const clientId = process.env.JIRA_CLIENT_ID;
  const clientSecret = process.env.JIRA_CLIENT_SECRET;
  if (!clientId?.trim() || !clientSecret?.trim() || /[\r\n]/.test(clientId + clientSecret)) {
    throw new Error("Jira provider configuration is invalid");
  }
  return { clientId, clientSecret, callbackUrl: new URL("/api/integrations/jira/callback", siteUrl()).toString() };
}
export function getProviderSetup(provider: "jira") {
  try { return { configured: true as const, provider, callbackUrl: getJiraProviderConfig().callbackUrl }; }
  catch { return { configured: false as const, provider }; }
}
