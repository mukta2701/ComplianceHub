import type { TicketProvider, IntegrationProvider } from "@/features/integrations/domain/provider";
import { fakeTicketProvider } from "@/features/integrations/domain/provider";
import { jiraProvider } from "./jira";
import { githubProvider } from "./github";

// Mode is the trust boundary: local sandbox rows are always deterministic and
// network-free; verified OAuth rows always use the Nango-backed adapter.
export function resolveTicketProvider(connection: {
  provider: IntegrationProvider;
  connectionMode: "sandbox" | "oauth";
}): TicketProvider {
  if (connection.connectionMode === "sandbox") return fakeTicketProvider;
  return connection.provider === "jira" ? jiraProvider : githubProvider;
}
