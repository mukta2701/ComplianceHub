import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeMonitorProvider } from "../domain/monitor-provider";
import { githubMonitorProvider } from "./github-monitor";
import { resolveMonitorProvider } from "./monitor-registry";

describe("monitor provider mode routing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps sandbox sources fake even when the old live flag is set", () => {
    vi.stubEnv("MONITORING_LIVE", "1");
    expect(resolveMonitorProvider({ provider: "github", connectionMode: "sandbox" })).toBe(fakeMonitorProvider);
  });

  it("routes OAuth sources to the Nango-backed monitor without a global flag", () => {
    vi.stubEnv("MONITORING_LIVE", "");
    expect(resolveMonitorProvider({ provider: "github", connectionMode: "oauth" })).toBe(githubMonitorProvider);
  });
});
