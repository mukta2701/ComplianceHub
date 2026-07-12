import type { MonitorProvider, MonitorProviderKind } from "../domain/monitor-provider";
import { fakeMonitorProvider } from "../domain/monitor-provider";

// The fake monitor is the default (dev + tests + sandbox demo). Live monitoring of
// a real GitHub org/repo is opt-in via MONITORING_LIVE=1 and requires the user's
// OAuth-app token on the source (a documented go-live step). The real network
// adapter (poll the GitHub API for branch-protection / org-2FA / audit-log
// posture) is Phase 2; the live registry below still returns the fake per
// provider so no live network reaches tests until that adapter lands.
const LIVE_PROVIDERS: Record<MonitorProviderKind, MonitorProvider> = {
  // TODO(monitoring Phase 2): replace with the real GitHub REST adapter.
  github: fakeMonitorProvider,
};

export function resolveMonitorProvider(provider: MonitorProviderKind): MonitorProvider {
  if (process.env.MONITORING_LIVE === "1") return LIVE_PROVIDERS[provider];
  return fakeMonitorProvider;
}
