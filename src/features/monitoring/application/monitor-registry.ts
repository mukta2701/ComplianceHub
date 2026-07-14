import type { MonitorProvider, MonitorProviderKind } from "../domain/monitor-provider";
import { fakeMonitorProvider } from "../domain/monitor-provider";
import { githubMonitorProvider } from "./github-monitor";

// As with ticketing, source mode is the network boundary. Sandbox is always
// deterministic; OAuth is always the real brokered GitHub monitor.
export function resolveMonitorProvider(connection: {
  provider: MonitorProviderKind;
  connectionMode: "sandbox" | "oauth";
}): MonitorProvider {
  return connection.connectionMode === "oauth" ? githubMonitorProvider : fakeMonitorProvider;
}
