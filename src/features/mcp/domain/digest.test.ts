import { describe, expect, it } from "vitest";
import {
  buildDailyDigestFacts,
  buildSlackDigestPayload,
  dailyDigestMessageSchema,
  hashDailyDigestFacts,
  validateDigestMessageAgainstFacts,
} from "./digest";

const overview = {
  soaPercent: 72,
  soaTotal: 100,
  riskBands: { low: 4, moderate: 3, high: 2, very_high: 1 },
  tasksOpen: 7,
  tasksOverdue: 2,
  evidence: { total: 12, expiring: 2, expired: 1 },
  openAudits: 1,
  openNonConformities: 3,
};

function makeFacts(reverse = false) {
  const attentionItems = [
    { id: "task-z", category: "overdue_task" as const, severity: "high" as const, summary: "  Review access controls  ", dueOn: "2026-08-05" },
    { id: "risk-a", category: "high_risk" as const, severity: "critical" as const, summary: "Treat supplier risk" },
    { id: "evidence-b", category: "stale_evidence" as const, severity: "medium" as const, summary: "Refresh backup evidence" },
  ];
  const monitoringFindings = [
    { id: "finding-b", severity: "high" as const, status: "open", title: "Branch protection disabled", detectedAt: "2026-08-06T07:00:00.000Z" },
    { id: "finding-a", severity: "critical" as const, status: "open", title: "Secret scanning disabled", detectedAt: "2026-08-06T06:00:00.000Z" },
  ];
  return buildDailyDigestFacts({
    workspace: { id: "00000000-0000-4000-8000-000000000001", name: "Internal ISMS" },
    localDate: "2026-08-06",
    overview,
    attentionItems: reverse ? attentionItems.reverse() : attentionItems,
    monitoringFindings: reverse ? monitoringFindings.reverse() : monitoringFindings,
    latestLeadershipReport: { id: "report-1", publishedAt: "2026-08-05T16:00:00.000Z" },
    limits: { attentionItems: 2, monitoringFindings: 1 },
  });
}

describe("daily digest facts", () => {
  it("normalises, orders, and bounds closed-world facts deterministically", () => {
    const facts = makeFacts();

    expect(facts.schemaVersion).toBe(1);
    expect(facts.attentionItems.map((item) => item.id)).toEqual(["risk-a", "task-z"]);
    expect(facts.attentionItems[1]?.summary).toBe("Review access controls");
    expect(facts.monitoringFindings.map((item) => item.id)).toEqual(["finding-a"]);
    expect(facts.truncation).toEqual({ attentionItems: true, monitoringFindings: true });
    expect(facts.latestLeadershipReport).toEqual({ id: "report-1", publishedAt: "2026-08-05T16:00:00.000Z" });
  });

  it("produces the same hash for equivalent inputs and a new hash when a fact changes", () => {
    const facts = makeFacts();
    const equivalent = makeFacts(true);

    expect(hashDailyDigestFacts(equivalent)).toBe(hashDailyDigestFacts(facts));
    expect(hashDailyDigestFacts({ ...facts, overview: { ...facts.overview, tasksOverdue: 3 } })).not.toBe(hashDailyDigestFacts(facts));
    expect(hashDailyDigestFacts(facts)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects impossible local dates", () => {
    expect(() => buildDailyDigestFacts({
      workspace: { id: "00000000-0000-4000-8000-000000000001", name: "Internal ISMS" },
      localDate: "2026-02-30",
      overview,
      attentionItems: [],
      monitoringFindings: [],
      latestLeadershipReport: null,
    })).toThrow(/localDate/i);
  });
});

describe("daily digest message", () => {
  it("allows one headline and at most five priorities and actions", () => {
    expect(dailyDigestMessageSchema.parse({
      headline: "Compliance needs attention",
      priorities: ["2 overdue tasks", "1 very-high risk"],
      actions: ["Review access controls"],
    })).toEqual({
      headline: "Compliance needs attention",
      priorities: ["2 overdue tasks", "1 very-high risk"],
      actions: ["Review access controls"],
    });

    expect(() => dailyDigestMessageSchema.parse({
      headline: "Too many",
      priorities: ["1", "2", "3", "4", "5", "6"],
      actions: [],
    })).toThrow();
  });

  it.each([
    "See https://hooks.slack.com/services/secret",
    "Email owner@example.test",
    "Use Bearer abc123",
    "token=secret-value",
    "line one\nline two",
  ])("rejects sensitive or multiline outgoing text: %s", (headline) => {
    expect(() => dailyDigestMessageSchema.parse({ headline, priorities: [], actions: [] })).toThrow();
  });

  it("rejects numerical claims not present in the prepared facts", () => {
    const facts = makeFacts();
    expect(validateDigestMessageAgainstFacts({
      headline: "Compliance needs attention",
      priorities: ["2 overdue tasks and 1 very-high risk"],
      actions: ["Review the 3 open non-conformities"],
    }, facts)).toEqual({ ok: true });

    expect(validateDigestMessageAgainstFacts({
      headline: "9 overdue tasks",
      priorities: [],
      actions: [],
    }, facts)).toEqual({ ok: false, unsupportedNumbers: [9] });
  });

  it("renders bounded Slack blocks without accepting or exposing a destination", () => {
    const payload = buildSlackDigestPayload({
      headline: "Compliance needs attention",
      priorities: ["2 overdue tasks"],
      actions: ["Review access controls"],
    }, { workspaceName: "Internal ISMS", localDate: "2026-08-06" });

    expect(payload.text).toBe("ComplianceHub daily brief — Internal ISMS — 2026-08-06");
    expect(payload.blocks).toHaveLength(4);
    expect(JSON.stringify(payload)).not.toContain("webhook");
    expect(payload).not.toHaveProperty("channel");
  });
});
