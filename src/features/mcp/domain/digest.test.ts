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
const privateKeyExample = ["private_key=-----BEGIN", "PRIVATE", "KEY-----abc"].join(" ");
const awsAccessKeyId = ["AK", "IAIOSFODNN7EXAMPLE"].join("");

function makeFacts(reverse = false) {
  const attentionItems = [
    { id: "task:task-z", category: "overdue_task" as const, severity: "high" as const, summary: "  Review access controls  ", dueOn: "2026-08-05", source: "task" as const },
    { id: "risk:risk-a", category: "high_risk" as const, severity: "critical" as const, summary: "Treat supplier risk", source: "risk" as const },
    { id: "evidence:evidence-b", category: "stale_evidence" as const, severity: "medium" as const, summary: "Refresh backup evidence", source: "evidence" as const },
  ];
  const monitoringFindings = [
    { id: "monitoring_finding:finding-b", severity: "high" as const, status: "open", title: "Branch protection disabled", detectedAt: "2026-08-06T07:00:00.000Z" },
    { id: "monitoring_finding:finding-a", severity: "critical" as const, status: "open", title: "Secret scanning disabled", detectedAt: "2026-08-06T06:00:00.000Z" },
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
    expect(facts.attentionItems.map((item) => item.id)).toEqual(["risk:risk-a", "task:task-z"]);
    expect(facts.attentionItems[1]?.summary).toBe("Review access controls");
    expect(facts.monitoringFindings.map((item) => item.id)).toEqual(["monitoring_finding:finding-a"]);
    expect(facts.truncation).toEqual({ attentionItems: true, monitoringFindings: true });
    expect(facts.latestLeadershipReport).toEqual({ id: "report-1", publishedAt: "2026-08-05T16:00:00.000Z" });
  });

  it("preserves severity, date, category, source, and ID priority in canonical facts", () => {
    const facts = buildDailyDigestFacts({
      workspace: { id: "00000000-0000-4000-8000-000000000001", name: "Internal ISMS" }, localDate: "2026-08-06", overview,
      attentionItems: [
        { id: "risk:b", category: "high_risk", severity: "critical", summary: "B", source: "risk" },
        { id: "audit_finding:a", category: "unresolved_finding", severity: "critical", summary: "A", source: "audit_finding", observedOn: "2026-08-01T00:00:00Z" },
        { id: "evidence:c", category: "stale_evidence", severity: "critical", summary: "C", source: "evidence", dueOn: "2026-08-02" },
      ],
      monitoringFindings: [
        { id: "monitoring_finding:a", severity: "critical", status: "open", title: "A", detectedAt: "2026-08-01T00:00:00Z" },
        { id: "monitoring_finding:z", severity: "critical", status: "open", title: "Z", detectedAt: "2026-08-02T00:00:00Z" },
      ], latestLeadershipReport: null,
    });
    expect(facts.attentionItems.map(({ id }) => id)).toEqual(["audit_finding:a", "evidence:c", "risk:b"]);
    expect(facts.monitoringFindings.map(({ id }) => id)).toEqual(["monitoring_finding:z", "monitoring_finding:a"]);
  });

  it("uses London calendar dates at the bounded attention cutoff after severity", () => {
    const facts = buildDailyDigestFacts({
      workspace: { id: "00000000-0000-4000-8000-000000000001", name: "Internal ISMS" },
      localDate: "2026-07-02", overview,
      attentionItems: [
        { id: "audit_finding:same-day", category: "unresolved_finding", severity: "high", summary: "Same day finding", source: "audit_finding", observedOn: "2026-06-30T23:30:00Z" },
        { id: "task:same-day", category: "overdue_task", severity: "high", summary: "Same day task", source: "task", dueOn: "2026-07-01" },
        { id: "policy:same-day", category: "policy_review", severity: "high", summary: "Same day policy", source: "policy", dueOn: "2026-07-01" },
      ],
      monitoringFindings: [], latestLeadershipReport: null,
      limits: { attentionItems: 1 },
    });
    expect(facts.attentionItems.map(({ id }) => id)).toEqual(["task:same-day"]);
    expect(facts.truncation.attentionItems).toBe(true);
  });

  it("treats a BST timestamp and due date on the same London day as a priority-date tie", () => {
    const input = {
      workspace: { id: "00000000-0000-4000-8000-000000000001", name: "Internal ISMS" },
      localDate: "2026-07-02", overview, monitoringFindings: [], latestLeadershipReport: null,
      attentionItems: [
        { id: "audit_finding:observed", category: "unresolved_finding" as const, severity: "high" as const, summary: "Observed", source: "audit_finding" as const, observedOn: "2026-06-30T23:30:00Z" },
        { id: "task:due", category: "overdue_task" as const, severity: "high" as const, summary: "Due", source: "task" as const, dueOn: "2026-07-01" },
      ],
    };
    const first = buildDailyDigestFacts(input);
    const reversed = buildDailyDigestFacts({ ...input, attentionItems: [...input.attentionItems].reverse() });
    expect(first.attentionItems.map(({ id }) => id)).toEqual(["task:due", "audit_finding:observed"]);
    expect(hashDailyDigestFacts(first)).toBe(hashDailyDigestFacts(reversed));
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

  it("rejects IDs that do not match their closed-world source", () => {
    expect(() => buildDailyDigestFacts({
      workspace: { id: "00000000-0000-4000-8000-000000000001", name: "Internal ISMS" }, localDate: "2026-08-06", overview,
      attentionItems: [{ id: "risk-id", category: "high_risk", severity: "high", summary: "Risk", source: "risk" }],
      monitoringFindings: [], latestLeadershipReport: null,
    })).toThrow(/source-prefixed/i);
  });

  it("rejects duplicate attention and monitoring IDs before hashing", () => {
    const base = {
      workspace: { id: "00000000-0000-4000-8000-000000000001", name: "Internal ISMS" },
      localDate: "2026-08-06", overview, latestLeadershipReport: null,
    };
    expect(() => buildDailyDigestFacts({
      ...base,
      attentionItems: [
        { id: "task:a", category: "overdue_task" as const, severity: "high" as const, summary: "A", source: "task" as const },
        { id: "task:a", category: "overdue_task" as const, severity: "high" as const, summary: "B", source: "task" as const },
      ],
      monitoringFindings: [],
    })).toThrow(/duplicate attention/i);
    expect(() => buildDailyDigestFacts({
      ...base,
      attentionItems: [],
      monitoringFindings: [
        { id: "monitoring_finding:a", severity: "high" as const, status: "open", title: "A", detectedAt: "2026-08-06T00:00:00Z" },
        { id: "monitoring_finding:a", severity: "high" as const, status: "open", title: "B", detectedAt: "2026-08-06T01:00:00Z" },
      ],
    })).toThrow(/duplicate monitoring/i);
  });

  it("rejects internally inconsistent overview counts", () => {
    const base = { workspace: { id: "00000000-0000-4000-8000-000000000001", name: "Internal ISMS" }, localDate: "2026-08-06", attentionItems: [], monitoringFindings: [], latestLeadershipReport: null };
    expect(() => buildDailyDigestFacts({ ...base, overview: { ...overview, tasksOpen: 1, tasksOverdue: 2 } })).toThrow();
    expect(() => buildDailyDigestFacts({ ...base, overview: { ...overview, evidence: { total: 1, expiring: 1, expired: 1 } } })).toThrow();
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
    "client_secret=super-sensitive-value",
    privateKeyExample,
    "private key: hidden-material",
    "clientSecret=camel-case-value",
    "AWS_SECRET_ACCESS_KEY=abcdefghijklmnopqrstuvwxyz1234567890",
    "secret_access_key: abcdefghijklmnopqrstuvwxyz",
    `access_key_id=${awsAccessKeyId}`,
    "Authorization: Basic Zm9vOmJhcg==",
    "Authorization: Bearer abc.def.ghi",
    "signing_secret=signing-value",
    "webhook_secret: hook-value",
    awsAccessKeyId,
  ])("rejects sensitive or multiline outgoing text: %s", (headline) => {
    expect(() => dailyDigestMessageSchema.parse({ headline, priorities: [], actions: [] })).toThrow();
  });

  it("rejects numerical claims not present in the prepared facts", () => {
    const facts = makeFacts();
    expect(validateDigestMessageAgainstFacts({
      headline: "72% ready",
      priorities: ["2 overdue tasks and 1 very-high risk"],
      actions: ["Review 3 open non-conformities"],
    }, facts)).toEqual({ ok: true });

    expect(validateDigestMessageAgainstFacts({
      headline: "9 overdue tasks",
      priorities: [],
      actions: [],
    }, facts)).toEqual({ ok: false, unsupportedNumbers: [9] });
  });

  it.each([
    "All systems are secure",
    "No customer data is at risk",
    "nine overdue tasks",
  ])("rejects an unsupported closed-world claim: %s", (headline) => {
    expect(validateDigestMessageAgainstFacts({
      headline,
      priorities: [],
      actions: [],
    }, makeFacts()).ok).toBe(false);
  });

  it("requires every digest line to be an exact returned literal or a supported metric claim", () => {
    const facts = makeFacts();
    expect(validateDigestMessageAgainstFacts({
      headline: "72% ready",
      priorities: ["Treat supplier risk", "2 overdue tasks"],
      actions: ["Review 3 open non-conformities"],
    }, facts)).toEqual({ ok: true });

    expect(validateDigestMessageAgainstFacts({
      headline: "72% ready and everything else looks healthy",
      priorities: ["Treat supplier risk urgently"],
      actions: ["Review 3 open non-conformities"],
    }, facts).ok).toBe(false);
  });

  it("binds numerical claims to their exact compliance metric", () => {
    const facts = makeFacts();

    expect(validateDigestMessageAgainstFacts({
      headline: "72% ready",
      priorities: ["12 overdue tasks"],
      actions: [],
    }, facts)).toEqual({ ok: false, unsupportedNumbers: [12] });

    expect(validateDigestMessageAgainstFacts({
      headline: "72% ready",
      priorities: ["6 high risks"],
      actions: [],
    }, facts)).toEqual({ ok: false, unsupportedNumbers: [6] });

    expect(validateDigestMessageAgainstFacts({
      headline: "72% ready",
      priorities: ["72% ready", "7 open tasks", "12 evidence items", "2 high risks"],
      actions: ["Review 3 open non-conformities"],
    }, facts)).toEqual({ ok: true });
  });

  it("allows only exact prepared dates, control references, identifiers, and bounded fact text", () => {
    const facts = buildDailyDigestFacts({
      workspace: { id: "00000000-0000-4000-8000-000000000001", name: "Internal ISMS" },
      localDate: "2026-08-06",
      overview,
      attentionItems: [{
        id: "task:task-27001",
        category: "overdue_task",
        severity: "high",
        summary: "Review ISO 27001 renewal",
        dueOn: "2026-08-05",
        source: "task",
      }],
      monitoringFindings: [{
        id: "monitoring_finding:finding-a",
        severity: "critical",
        status: "open",
        title: "Control A.8.1 is disabled",
        controlRef: "A.8.1",
        detectedAt: "2026-08-06T06:00:00.000Z",
      }],
      latestLeadershipReport: null,
    });

    expect(validateDigestMessageAgainstFacts({
      headline: "72% ready",
      priorities: ["Review ISO 27001 renewal", "Control A.8.1 is disabled"],
      actions: ["Review ISO 27001 renewal"],
    }, facts)).toEqual({ ok: true });

    expect(validateDigestMessageAgainstFacts({
      headline: "72% ready",
      priorities: ["Complete by 2026-08-04", "Control A.9.1 needs review", "80% ready"],
      actions: [],
    }, facts)).toEqual({ ok: false, unsupportedNumbers: [4, 8, 9.1, 80, 2026] });
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

  it("renders empty priority and action sections without fabricating a no-findings claim", () => {
    const payload = buildSlackDigestPayload({
      headline: "72% ready",
      priorities: [],
      actions: [],
    }, { workspaceName: "Internal ISMS", localDate: "2026-08-06" });

    const rendered = JSON.stringify(payload);
    expect(rendered).not.toContain("None reported");
    expect(rendered).toContain("Priorities");
    expect(rendered).toContain("Actions");
  });
});
