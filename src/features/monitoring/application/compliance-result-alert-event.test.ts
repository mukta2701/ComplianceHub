import { describe, expect, it } from "vitest";
import {
  buildComplianceResultAlertEvent,
  type ComplianceResultAlertInput,
} from "./compliance-result-alert-event";

const organisationId = "10000000-0000-4000-8000-000000000001";
const repositoryId = "10000000-0000-4000-8000-000000000002";
const failureFindingId = "10000000-0000-4000-8000-000000000003";
const recoveryEvidenceId = "10000000-0000-4000-8000-000000000004";
const appOrigin = "https://dev.compliancehub.example";
const observedAt = "2026-09-24T10:00:00.000Z";

function input(overrides: Partial<ComplianceResultAlertInput> = {}): ComplianceResultAlertInput {
  return {
    organisationId,
    repositoryId,
    repositorySlug: "acme/isms",
    checkId: "github.branch.force_pushes",
    previousOutcome: "pass",
    current: {
      id: "10000000-0000-4000-8000-000000000005",
      outcome: "fail",
      observedAt,
      freshUntil: "2026-09-25T22:00:00.000Z",
      findingId: failureFindingId,
      evidenceId: null,
      severity: "high",
    },
    actionableUnknownSince: null,
    activeIncident: null,
    evaluatedAt: "2026-09-24T10:01:00.000Z",
    appOrigin,
    ...overrides,
  };
}

function readyEvent(value: ReturnType<typeof buildComplianceResultAlertEvent>) {
  if (value.status !== "event") throw new Error(`Expected a ComplianceHub alert event, received ${JSON.stringify(value)}`);
  return value.event;
}

describe("buildComplianceResultAlertEvent", () => {
  it("builds a new Failure alert with a private-team target and exact Finding link", () => {
    const event = readyEvent(buildComplianceResultAlertEvent(input({ previousOutcome: "pass" })));

    expect(event.kind).toBe("failure");
    expect(event.recordUrl).toBe(`${appOrigin}/app/monitoring?finding=${failureFindingId}#finding-${failureFindingId}`);
    expect(event.slack).toEqual({ destination: "approved_private_team_channel", actions: [] });
    expect(event.text).toContain("Repository: acme/isms");
    expect(event.text).toContain("Check: github.branch.force_pushes");
    expect(event.text).not.toContain("@here");
  });

  it("accepts valid provider timestamps with offsets and fractional seconds", () => {
    const value = input({
      current: {
        ...input().current,
        observedAt: "2026-09-24T10:00:00.123456+00:00",
        freshUntil: "2026-09-25T22:00:00.654321+00:00",
      },
      evaluatedAt: "2026-09-24T10:01:00.000000+00:00",
    });

    expect(readyEvent(buildComplianceResultAlertEvent(value)).kind).toBe("failure");
  });

  it("waits 36 hours for actionable Unknown and blocks it when no exact record exists", () => {
    const current = {
      id: "10000000-0000-4000-8000-000000000006",
      outcome: "unknown" as const,
      observedAt: "2026-09-24T08:00:00.000Z",
      freshUntil: "2026-09-25T20:00:00.000Z",
      findingId: null,
      evidenceId: null,
      severity: null,
    };
    const beforeDeadline = buildComplianceResultAlertEvent(input({
      previousOutcome: "unknown",
      current,
      actionableUnknownSince: "2026-09-23T10:00:00.000Z",
      evaluatedAt: "2026-09-24T21:59:59.999Z",
    }));
    const atDeadline = buildComplianceResultAlertEvent(input({
      previousOutcome: "unknown",
      current,
      actionableUnknownSince: "2026-09-23T10:00:00.000Z",
      evaluatedAt: "2026-09-24T22:00:00.000Z",
    }));

    expect(beforeDeadline.status).toBe("suppressed");
    expect(atDeadline).toMatchObject({ status: "blocked", kind: "sustained_unknown", reason: "missing_record" });
  });

  it("alerts stale saved results from the clock even when no newer successful collection arrived", () => {
    const stale = buildComplianceResultAlertEvent(input({
      current: {
        ...input().current,
        observedAt: "2026-09-23T22:00:00.000Z",
        freshUntil: "2026-09-24T10:00:00.000Z",
      },
      evaluatedAt: "2026-09-24T10:00:00.001Z",
    }));

    expect(readyEvent(stale)).toMatchObject({
      kind: "stale",
      recordUrl: `${appOrigin}/app/monitoring?finding=${failureFindingId}#finding-${failureFindingId}`,
    });
  });

  it("chooses stale over a simultaneous sustained Unknown when the record is not addressable", () => {
    const result = buildComplianceResultAlertEvent(input({
      current: {
        id: "10000000-0000-4000-8000-000000000007",
        outcome: "unknown",
        observedAt: "2026-09-23T10:00:00.000Z",
        freshUntil: "2026-09-24T22:00:00.000Z",
        findingId: null,
        evidenceId: null,
        severity: null,
      },
      actionableUnknownSince: "2026-09-23T10:00:00.000Z",
      evaluatedAt: "2026-09-24T22:00:00.001Z",
    }));

    expect(result).toMatchObject({ status: "blocked", kind: "stale", reason: "missing_record" });
  });

  it("sends one verified recovery and gives a later same-day Failure a new incident identity", () => {
    const failed = readyEvent(buildComplianceResultAlertEvent(input({
      previousOutcome: "pass",
      activeIncident: null,
    })));
    const recovered = readyEvent(buildComplianceResultAlertEvent(input({
      previousOutcome: "fail",
      current: {
        id: "10000000-0000-4000-8000-000000000008",
        outcome: "pass",
        observedAt: "2026-09-24T12:00:00.000Z",
        freshUntil: "2026-09-26T00:00:00.000Z",
        findingId: null,
        evidenceId: recoveryEvidenceId,
        severity: null,
      },
      activeIncident: { kind: "failure", incidentKey: failed.incidentKey, startedAt: observedAt },
      evaluatedAt: "2026-09-24T12:01:00.000Z",
    })));
    const secondFailure = readyEvent(buildComplianceResultAlertEvent(input({
      previousOutcome: "pass",
      current: {
        ...input().current,
        id: "10000000-0000-4000-8000-000000000009",
        observedAt,
      },
      activeIncident: null,
      evaluatedAt: "2026-09-24T15:01:00.000Z",
    })));
    const recoveryWithoutEvidence = buildComplianceResultAlertEvent(input({
      previousOutcome: "fail",
      current: {
        id: "10000000-0000-4000-8000-000000000012",
        outcome: "pass",
        observedAt: "2026-09-24T16:00:00.000Z",
        freshUntil: "2026-09-26T04:00:00.000Z",
        findingId: null,
        evidenceId: null,
        severity: null,
      },
      activeIncident: { kind: "failure", incidentKey: failed.incidentKey, startedAt: observedAt },
      evaluatedAt: "2026-09-24T16:01:00.000Z",
    }));

    expect(recovered.kind).toBe("recovery");
    expect(recovered.recordUrl).toBe(`${appOrigin}/app/evidence?evidence=${recoveryEvidenceId}#evidence-${recoveryEvidenceId}`);
    expect(secondFailure.kind).toBe("failure");
    expect(secondFailure.incidentKey).not.toBe(failed.incidentKey);
    expect(recoveryWithoutEvidence).toMatchObject({ status: "blocked", kind: "recovery", reason: "missing_record" });
  });

  it("suppresses unchanged Pass, keeps duplicate keys stable, and drops hostile provider copy", () => {
    const unchangedPass = buildComplianceResultAlertEvent(input({
      previousOutcome: "pass",
      current: {
        ...input().current,
        id: "10000000-0000-4000-8000-000000000010",
        outcome: "pass",
        findingId: null,
        evidenceId: recoveryEvidenceId,
        severity: null,
      },
    }));
    const unsafeCurrent = {
      ...input().current,
      providerSummary: "@here\nAuthorization: bearer secret-value",
    } as ComplianceResultAlertInput["current"];
    const first = readyEvent(buildComplianceResultAlertEvent(input({ current: unsafeCurrent })));
    const duplicate = readyEvent(buildComplianceResultAlertEvent(input({ current: unsafeCurrent })));
    const activeFailure = buildComplianceResultAlertEvent(input({
      current: { ...unsafeCurrent, id: "10000000-0000-4000-8000-000000000011", observedAt: "2026-09-24T10:05:00.000Z" },
      activeIncident: { kind: "failure", incidentKey: first.incidentKey, startedAt: observedAt },
    }));
    const unsafeLink = buildComplianceResultAlertEvent(input({
      appOrigin: "http://untrusted.example",
    }));
    const localHttpByDefault = buildComplianceResultAlertEvent(input({
      appOrigin: "http://localhost:3100",
    }));
    const localDevValue = { ...input({ appOrigin: "http://localhost:3100" }), allowLocalHttp: true } as ComplianceResultAlertInput;
    const localHttpOptIn = buildComplianceResultAlertEvent(localDevValue);
    const malformedIncident = buildComplianceResultAlertEvent(input({
      activeIncident: { kind: "failure", incidentKey: "not-a-digest", startedAt: observedAt },
    }));

    expect(unchangedPass).toMatchObject({ status: "suppressed", reason: "unchanged_pass" });
    expect(duplicate.idempotencyKey).toBe(first.idempotencyKey);
    expect(first.text).not.toContain("Authorization");
    expect(first.text).not.toContain("secret-value");
    expect(activeFailure).toMatchObject({ status: "suppressed", reason: "condition_not_met" });
    expect(unsafeLink).toMatchObject({ status: "blocked", reason: "invalid_app_origin" });
    expect(localHttpByDefault).toMatchObject({ status: "blocked", reason: "invalid_app_origin" });
    expect(readyEvent(localHttpOptIn).recordUrl).toBe(`http://localhost:3100/app/monitoring?finding=${failureFindingId}#finding-${failureFindingId}`);
    expect(malformedIncident).toMatchObject({ status: "blocked", reason: "invalid_input" });
  });
});
