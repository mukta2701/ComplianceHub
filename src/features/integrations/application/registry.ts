import type { TicketProvider, IntegrationProvider } from "@/features/integrations/domain/provider";
import { fakeTicketProvider } from "@/features/integrations/domain/provider";
import { jiraProvider } from "./jira";
import { githubProvider } from "./github";

// The fake provider is the default (dev + tests). Real Jira/GitHub calls are
// opt-in via INTEGRATIONS_LIVE=1, which requires the user's OAuth-app tokens on
// the connection (documented go-live step). This keeps live network out of tests.
export function resolveTicketProvider(provider: IntegrationProvider): TicketProvider {
  if (process.env.INTEGRATIONS_LIVE === "1") return provider === "jira" ? jiraProvider : githubProvider;
  return fakeTicketProvider;
}
