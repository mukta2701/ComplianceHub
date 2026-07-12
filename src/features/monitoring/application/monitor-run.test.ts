import { describe, expect, it, vi } from "vitest";
import { runMonitoring, findingKey, type MonitorDependencies, type MonitorSource } from "./monitor-run";
import type { CheckResult } from "../domain/monitor-provider";
import type { AlertChannel } from "./deliver";

const source: MonitorSource = { id: "src1", organisationId: "org1", provider: "github", config: {}, accessToken: "" };

function check(over: Partial<CheckResult> & { checkId: string; passed: boolean }): CheckResult {
  return { controlRef: "A.8.32", subjectType: "github_repo", subjectId: "acme/isms", severity: "critical", title: "t", detail: "d", ...over };
}

function deps(over: Partial<MonitorDependencies>): MonitorDependencies {
  return {
    listActiveSources: async () => [source],
    runChecks: async () => [],
    listOpenFindingKeys: async () => [],
    saveFinding: vi.fn().mockResolvedValue(undefined),
    resolveFindings: vi.fn().mockResolvedValue(0),
    listExternalChannels: async () => [],
    deliver: vi.fn().mockResolvedValue({ channelId: "ch1", type: "slack", status: "delivered" }),
    notifyInApp: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe("runMonitoring", () => {
  it("raises a finding, always fires the in-app pop-up, and fans out to external channels", async () => {
    const slack: AlertChannel = { id: "ch1", type: "slack", config: { webhookUrl: "https://hooks/x" }, minSeverity: "high" };
    const saveFinding = vi.fn().mockResolvedValue(undefined);
    const notifyInApp = vi.fn().mockResolvedValue(undefined);
    const deliver = vi.fn().mockResolvedValue({ channelId: "ch1", type: "slack", status: "delivered" });
    const d = deps({
      runChecks: async () => [check({ checkId: "github.branch_protection", passed: false })],
      listExternalChannels: async () => [slack],
      saveFinding, notifyInApp, deliver,
    });

    const summary = await runMonitoring(d);

    expect(summary.findingsRaised).toBe(1);
    expect(summary.alertsDelivered).toBe(1);
    expect(saveFinding).toHaveBeenCalledTimes(1);
    expect(notifyInApp).toHaveBeenCalledTimes(1); // always-on in-app
    expect(deliver).toHaveBeenCalledWith(slack, expect.objectContaining({ subjectId: "acme/isms" }));
  });

  it("does not re-raise a finding that is already open", async () => {
    const saveFinding = vi.fn().mockResolvedValue(undefined);
    const d = deps({
      runChecks: async () => [check({ checkId: "github.branch_protection", passed: false })],
      listOpenFindingKeys: async () => [findingKey("github.branch_protection", "acme/isms")],
      saveFinding,
    });
    const summary = await runMonitoring(d);
    expect(summary.findingsRaised).toBe(0);
    expect(saveFinding).not.toHaveBeenCalled();
  });

  it("auto-resolves an open finding whose check now passes", async () => {
    const resolveFindings = vi.fn().mockResolvedValue(1);
    const d = deps({
      runChecks: async () => [check({ checkId: "github.branch_protection", passed: true })],
      listOpenFindingKeys: async () => [findingKey("github.branch_protection", "acme/isms")],
      resolveFindings,
    });
    const summary = await runMonitoring(d);
    expect(resolveFindings).toHaveBeenCalledWith("org1", [findingKey("github.branch_protection", "acme/isms")]);
    expect(summary.findingsResolved).toBe(1);
  });

  it("isolates a source whose checks throw and keeps going", async () => {
    const d = deps({
      listActiveSources: async () => [source, { ...source, id: "src2" }],
      runChecks: vi.fn()
        .mockRejectedValueOnce(new Error("provider down"))
        .mockResolvedValueOnce([check({ checkId: "github.org_mfa", subjectType: "github_org", subjectId: "acme", passed: false })]),
    });
    const summary = await runMonitoring(d);
    expect(summary.sourcesFailed).toBe(1);
    expect(summary.sourcesChecked).toBe(1);
    expect(summary.findingsRaised).toBe(1);
  });

  it("counts a failed external delivery without aborting", async () => {
    const d = deps({
      runChecks: async () => [check({ checkId: "github.branch_protection", passed: false })],
      listExternalChannels: async () => [{ id: "ch1", type: "slack", config: { webhookUrl: "https://hooks/x" }, minSeverity: "high" }],
      deliver: vi.fn().mockResolvedValue({ channelId: "ch1", type: "slack", status: "failed", reason: "503" }),
    });
    const summary = await runMonitoring(d);
    expect(summary.alertsFailed).toBe(1);
    expect(summary.alertsDelivered).toBe(0);
  });
});
