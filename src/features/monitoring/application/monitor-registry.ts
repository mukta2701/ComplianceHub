import type {
  MonitorConnectionMode,
  MonitorProvider,
  MonitorProviderKind,
} from "../domain/monitor-provider";
import { fakeMonitorProvider } from "../domain/monitor-provider";
import { githubMonitorProvider } from "./github-monitor";
import { createJiraMonitorProvider, type JiraGetRequest } from "./jira-monitor";

export type NativeMonitorRequestPorts = {
  jiraRequest?: JiraGetRequest;
};

// As with ticketing, source mode is the network boundary. Sandbox is always
// deterministic; OAuth is always the real brokered GitHub monitor.
export function resolveMonitorProvider(connection: {
  provider: MonitorProviderKind;
  connectionMode: MonitorConnectionMode;
}, ports: NativeMonitorRequestPorts = {}): MonitorProvider {
  if (connection.connectionMode === "sandbox") return fakeMonitorProvider;
  if (connection.provider === "github" && connection.connectionMode === "oauth") {
    return githubMonitorProvider;
  }
  if (connection.provider === "jira" && connection.connectionMode === "jira_oauth") {
    if (!ports.jiraRequest) throw new Error("Jira monitoring is unavailable");
    return createJiraMonitorProvider({ request: ports.jiraRequest });
  }
  throw new Error("Connection mode does not match monitoring provider");
}
