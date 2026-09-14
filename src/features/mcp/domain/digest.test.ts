import { describe, expect, it } from "vitest";
import {
  buildDailyDigestFacts,
  buildGitHubDigestLines,
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
const github = {
  partition: {
    activeCurrentPass: 1,
    activeCurrentFail: 1,
    activeCurrentUnknown: 1,
    activeCurrentNotApplicable: 1,
    activeStale: 1,
    historical: 1,
    total: 6,
  },
  baseline: { deliveredAt: "2026-08-05T08:00:00.000Z", localDate: "2026-08-05" },
  changes: {
    counts: { newFailure: 1, reopen: 0, resolution: 1, supersedingPass: 0, total: 2 },
    items: [
      {
        id: "github_change:new_failure:10000000-0000-4000-8000-000000000011",
        kind: "new_failure" as const,
        resultId: "github_result:10000000-0000-4000-8000-000000000011",
        repositoryId: "10000000-0000-4000-8000-000000000021",
        repositoryLabel: "GitHub repository 10000000",
        checkId: "github.branch.required_reviews",
        result: "fail" as const,
        severity: "high" as const,
        summary: "Required pull-request reviews are not enforced.",
        observedAt: "2026-08-06T06:00:00.000Z",
        freshUntil: "2026-08-07T06:00:00.000Z",
        materialisedAt: "2026-08-06T06:01:00.000Z",
        occurredAt: "2026-08-06T06:00:00.000Z",
      },
      {
        id: "github_change:resolution:10000000-0000-4000-8000-000000000012",
        kind: "resolution" as const,
        resultId: "github_result:10000000-0000-4000-8000-000000000012",
        repositoryId: "10000000-0000-4000-8000-000000000022",
        repositoryLabel: "GitHub repository 10000000",
        checkId: "github.secret_scanning.enabled",
        result: "pass" as const,
        severity: null,
        summary: "Secret scanning is enabled.",
        observedAt: "2026-08-06T07:00:00.000Z",
        freshUntil: "2026-08-07T07:00:00.000Z",
        materialisedAt: "2026-08-06T07:01:00.000Z",
        occurredAt: "2026-08-06T07:00:00.000Z",
      },
    ],
    truncated: false,
  },
  unknowns: {
    count: 1,
    items: [{
      id: "github_result:10000000-0000-4000-8000-000000000013",
      repositoryId: "10000000-0000-4000-8000-000000000023",
      repositoryLabel: "GitHub repository 10000000",
      checkId: "github.dependabot.alerts",
      result: "unknown" as const,
      severity: null,
      summary: "Dependabot alert availability is unknown.",
      observedAt: "2026-08-06T08:00:00.000Z",
      freshUntil: "2026-08-07T08:00:00.000Z",
      materialisedAt: "2026-08-06T08:01:00.000Z",
    }],
    truncated: false,
  },
  staleResults: {
    count: 1,
    items: [{
      id: "github_result:10000000-0000-4000-8000-000000000014",
      repositoryId: "10000000-0000-4000-8000-000000000024",
      repositoryLabel: "GitHub repository 10000000",
      checkId: "github.code_scanning.alerts",
      result: "pass" as const,
      severity: null,
      summary: "Code scanning reported no open high-severity alerts.",
      observedAt: "2026-08-04T08:00:00.000Z",
      freshUntil: "2026-08-05T08:00:00.000Z",
      materialisedAt: "2026-08-04T08:01:00.000Z",
    }],
    truncated: false,
  },
  recommendedActions: {
    count: 1,
    items: [{
      id: "github_result:10000000-0000-4000-8000-000000000015",
      repositoryId: "10000000-0000-4000-8000-000000000025",
      repositoryLabel: "GitHub repository 10000000",
      checkId: "github.branch.required_reviews",
      result: "fail" as const,
      severity: "critical" as const,
      summary: "Required pull-request reviews are not enforced.",
      observedAt: "2026-08-06T09:00:00.000Z",
      freshUntil: "2026-08-07T09:00:00.000Z",
      materialisedAt: "2026-08-06T09:01:00.000Z",
    }],
    truncated: false,
  },
};

function makeFacts(reverse = false, githubFacts = github) {
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
    github: githubFacts,
    limits: { attentionItems: 2, monitoringFindings: 1 },
  });
}

describe("daily digest facts", () => {
  it("requires verified GitHub facts instead of synthesising an authoritative all-clear section", () => {
    const withoutGitHub = {
      workspace: { id: "00000000-0000-4000-8000-000000000001", name: "Internal ISMS" },
      localDate: "2026-08-06",
      overview,
      attentionItems: [],
      monitoringFindings: [],
      latestLeadershipReport: null,
    };

    // @ts-expect-error Schema v2 callers must provide the verified GitHub projection.
    expect(() => buildDailyDigestFacts(withoutGitHub)).toThrow(/github/i);
  });

  it("normalises, orders, and bounds closed-world facts deterministically", () => {
    const facts = makeFacts();

    expect(facts.schemaVersion).toBe(2);
    expect(facts.attentionItems.map((item) => item.id)).toEqual(["risk:risk-a", "task:task-z"]);
    expect(facts.attentionItems[1]?.summary).toBe("Review access controls");
    expect(facts.monitoringFindings.map((item) => item.id)).toEqual(["monitoring_finding:finding-a"]);
    expect(facts.truncation).toEqual({ attentionItems: true, monitoringFindings: true });
    expect(facts.latestLeadershipReport).toEqual({ id: "report-1", publishedAt: "2026-08-05T16:00:00.000Z" });
    expect(facts.github.partition.total).toBe(6);
    expect(facts.github.lines.headline).toBe("Verified GitHub technical fact: 1 current failure");
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
      ], latestLeadershipReport: null, github,
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
      monitoringFindings: [], latestLeadershipReport: null, github,
      limits: { attentionItems: 1 },
    });
    expect(facts.attentionItems.map(({ id }) => id)).toEqual(["task:same-day"]);
    expect(facts.truncation.attentionItems).toBe(true);
  });

  it("treats a BST timestamp and due date on the same London day as a priority-date tie", () => {
    const input = {
      workspace: { id: "00000000-0000-4000-8000-000000000001", name: "Internal ISMS" },
      localDate: "2026-07-02", overview, monitoringFindings: [], latestLeadershipReport: null, github,
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

  it("hashes the exact GitHub partition, baseline, event and truncation state but ignores input ordering", () => {
    const facts = makeFacts();
    const reordered = makeFacts(false, {
      ...github,
      changes: { ...github.changes, items: [...github.changes.items].reverse() },
    });
    expect(hashDailyDigestFacts(reordered)).toBe(hashDailyDigestFacts(facts));
    expect(hashDailyDigestFacts({ ...facts, github: { ...facts.github, partition: { ...facts.github.partition, activeCurrentPass: 0, activeCurrentUnknown: 2 } } }))
      .not.toBe(hashDailyDigestFacts(facts));
    expect(hashDailyDigestFacts({ ...facts, github: { ...facts.github, baseline: null } }))
      .not.toBe(hashDailyDigestFacts(facts));
    expect(hashDailyDigestFacts({ ...facts, github: { ...facts.github, changes: { ...facts.github.changes, truncated: true } } }))
      .not.toBe(hashDailyDigestFacts(facts));
  });

  it("rejects impossible GitHub partitions, count/truncation shapes, outcome confusion, and unsafe local labels", () => {
    const base = {
      workspace: { id: "00000000-0000-4000-8000-000000000001", name: "Internal ISMS" },
      localDate: "2026-08-06", overview, attentionItems: [], monitoringFindings: [], latestLeadershipReport: null,
    };
    expect(() => buildDailyDigestFacts({ ...base, github: { ...github, partition: { ...github.partition, total: 7 } } })).toThrow(/partition/i);
    expect(() => buildDailyDigestFacts({ ...base, github: { ...github, unknowns: { ...github.unknowns, count: 2, truncated: false } } })).toThrow(/unknown/i);
    expect(() => buildDailyDigestFacts({
      ...base,
      github: { ...github, unknowns: { ...github.unknowns, items: [{ ...github.unknowns.items[0], result: "pass" as const }] } },
    })).toThrow(/unknown/i);
    expect(() => buildDailyDigestFacts({
      ...base,
      github: { ...github, recommendedActions: { ...github.recommendedActions, items: [{ ...github.recommendedActions.items[0], repositoryLabel: "octo/private" }] } },
    })).toThrow(/repository label/i);
    for (const [kind, result] of [["resolution", "unknown"], ["superseding_pass", "not_applicable"]] as const) {
      const passChange = github.changes.items[1]!;
      expect(() => buildDailyDigestFacts({
        ...base,
        github: {
          ...github,
          changes: {
            ...github.changes,
            items: github.changes.items.map((item, index) => index === 1 ? {
              ...passChange,
              id: `github_change:${kind}:${passChange.resultId.slice("github_result:".length)}`,
              kind,
              result,
              severity: null,
            } : item),
          },
        },
      })).toThrow(/change outcome/i);
    }
  });

  it("rejects a GitHub change materialised at the delivered baseline", () => {
    const base = {
      workspace: { id: "00000000-0000-4000-8000-000000000001", name: "Internal ISMS" },
      localDate: "2026-08-06", overview, attentionItems: [], monitoringFindings: [], latestLeadershipReport: null,
    };
    expect(() => buildDailyDigestFacts({
      ...base,
      github: {
        ...github,
        baseline: { ...github.baseline, deliveredAt: github.changes.items[0]!.materialisedAt },
      },
    })).toThrow(/baseline/i);
  });

  it("generates exact qualified GitHub metrics, facts, unknowns, stale results, and actions", () => {
    const lines = buildGitHubDigestLines(github);
    expect(lines.headline).toBe("Verified GitHub technical fact: 1 current failure");
    expect(lines.metrics).toEqual([
      "Verified GitHub technical fact: 6 official results",
      "Verified GitHub technical fact: 1 current pass",
      "Verified GitHub technical fact: 1 current failure",
      "Unknown GitHub information: 1 current result",
      "Verified GitHub technical fact: 1 current not-applicable result",
      "Stale GitHub result: 1 active-mapping result",
      "Verified GitHub technical fact: 1 historical-mapping result",
    ]);
    expect(lines.priorities).toEqual([
      "Verified GitHub technical fact: Resolution — GitHub repository 10000000 — github.secret_scanning.enabled — Secret scanning is enabled.",
      "Verified GitHub technical fact: New failure — GitHub repository 10000000 — github.branch.required_reviews — Required pull-request reviews are not enforced.",
      "Unknown GitHub information: GitHub repository 10000000 — github.dependabot.alerts — Dependabot alert availability is unknown.",
      "Stale GitHub result: GitHub repository 10000000 — github.code_scanning.alerts — pass — Code scanning reported no open high-severity alerts.",
    ]);
    expect(lines.actions).toEqual([
      "Recommended follow-up: Review verified failure — GitHub repository 10000000 — github.branch.required_reviews — Required pull-request reviews are not enforced.",
    ]);
  });

  it("rejects impossible local dates", () => {
    expect(() => buildDailyDigestFacts({
      workspace: { id: "00000000-0000-4000-8000-000000000001", name: "Internal ISMS" },
      localDate: "2026-02-30",
      overview,
      attentionItems: [],
      monitoringFindings: [],
      latestLeadershipReport: null,
      github,
    })).toThrow(/localDate/i);
  });

  it("rejects IDs that do not match their closed-world source", () => {
    expect(() => buildDailyDigestFacts({
      workspace: { id: "00000000-0000-4000-8000-000000000001", name: "Internal ISMS" }, localDate: "2026-08-06", overview,
      attentionItems: [{ id: "risk-id", category: "high_risk", severity: "high", summary: "Risk", source: "risk" }],
      monitoringFindings: [], latestLeadershipReport: null, github,
    })).toThrow(/source-prefixed/i);
  });

  it("rejects duplicate attention and monitoring IDs before hashing", () => {
    const base = {
      workspace: { id: "00000000-0000-4000-8000-000000000001", name: "Internal ISMS" },
      localDate: "2026-08-06", overview, latestLeadershipReport: null, github,
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
    const base = { workspace: { id: "00000000-0000-4000-8000-000000000001", name: "Internal ISMS" }, localDate: "2026-08-06", attentionItems: [], monitoringFindings: [], latestLeadershipReport: null, github };
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

  it("rejects combined or mismatched numerical claims", () => {
    const facts = makeFacts();
    expect(validateDigestMessageAgainstFacts({
      headline: "72% readiness",
      priorities: ["2 overdue tasks and 1 very-high risk"],
      actions: ["Review 3 open non-conformities"],
    }, facts).ok).toBe(false);

    expect(validateDigestMessageAgainstFacts({
      headline: "9 overdue tasks",
      priorities: [],
      actions: [],
    }, facts)).toEqual({ ok: false, unsupportedNumbers: [9] });
  });

  it.each([
    "72% ready",
    "readiness is 72%",
    "2 overdue tasks and 1 very-high risk",
    "1 very high risks",
    "100 SoA items",
  ])("rejects a non-canonical metric line: %s", (line) => {
    expect(validateDigestMessageAgainstFacts({
      headline: "72% readiness",
      priorities: [line],
      actions: [],
    }, makeFacts()).ok).toBe(false);
  });

  it("uses singular metric nouns only when the prepared count is one", () => {
    const facts = buildDailyDigestFacts({
      workspace: { id: "00000000-0000-4000-8000-000000000001", name: "Internal ISMS" },
      localDate: "2026-08-06",
      overview: {
        soaPercent: 1, soaTotal: 1,
        riskBands: { low: 1, moderate: 1, high: 1, very_high: 1 },
        tasksOpen: 1, tasksOverdue: 1,
        evidence: { total: 1, expiring: 1, expired: 0 },
        openAudits: 1, openNonConformities: 1,
      },
      attentionItems: [], monitoringFindings: [], latestLeadershipReport: null, github,
    });

    expect(validateDigestMessageAgainstFacts({
      headline: "1 SoA control",
      priorities: ["1 control", "1 open task", "1 overdue task", "1 evidence item", "1 very-high risk"],
      actions: ["review 1 high risk", "address 1 moderate risk", "resolve 1 low risk", "investigate 1 open audit", "prioritize 1 open non-conformity"],
    }, facts)).toEqual({ ok: true });

    for (const line of [
      "1 SoA controls", "1 controls", "1 open tasks", "1 overdue tasks", "1 evidence items",
      "1 very-high risks", "1 high risks", "1 moderate risks", "1 low risks",
      "1 open audits", "1 open non-conformities",
    ]) {
      expect(validateDigestMessageAgainstFacts({ headline: "1% readiness", priorities: [line], actions: [] }, facts).ok).toBe(false);
    }
  });

  it("rejects singular metric nouns when the prepared count is not one", () => {
    const facts = makeFacts();
    for (const line of [
      "100 SoA control", "100 control", "7 open task", "2 overdue task", "12 evidence item",
      "2 high risk", "3 moderate risk", "4 low risk", "3 open non-conformity",
    ]) {
      expect(validateDigestMessageAgainstFacts({ headline: "72% readiness", priorities: [line], actions: [] }, facts).ok).toBe(false);
    }
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
      headline: "72% readiness",
      priorities: ["Treat supplier risk", "2 overdue tasks"],
      actions: ["Review 3 open non-conformities"],
    }, facts)).toEqual({ ok: true });

    expect(validateDigestMessageAgainstFacts({
      headline: "72% readiness and everything else looks healthy",
      priorities: ["Treat supplier risk urgently"],
      actions: ["Review 3 open non-conformities"],
    }, facts).ok).toBe(false);
  });

  it("allows only exact server-owned GitHub lines and rejects count, status, decoration, and provider-text hallucinations", () => {
    const facts = makeFacts();
    const allowed = facts.github.lines;
    expect(validateDigestMessageAgainstFacts({
      headline: allowed.headline,
      priorities: [allowed.metrics[0]!, ...allowed.priorities.slice(0, 4)],
      actions: allowed.actions,
    }, facts)).toEqual({ ok: true });

    for (const line of [
      "Verified GitHub technical fact: 2 current failures",
      "Verified GitHub technical fact: 1 current pass — including the unknown result",
      `${allowed.priorities[0]} Urgent.`,
      "Verified GitHub technical fact: octo/private passed branch protection",
      "Unknown GitHub information: caused by a permissions outage",
      "Recommended follow-up: Finish by 2026-08-09",
      "Verified GitHub technical fact: https://github.example/private",
      "Verified GitHub technical fact: raw provider response says protection is disabled",
      "Verified GitHub technical fact: GitHub proves ISO certification and overall compliance",
      "Verified GitHub technical fact: GitHub proves readiness and security",
    ]) {
      let accepted = false;
      try {
        accepted = validateDigestMessageAgainstFacts({ headline: allowed.headline, priorities: [line], actions: [] }, facts).ok;
      } catch {
        accepted = false;
      }
      expect(accepted, line).toBe(false);
    }
  });

  it("binds numerical claims to their exact compliance metric", () => {
    const facts = makeFacts();

    expect(validateDigestMessageAgainstFacts({
      headline: "72% readiness",
      priorities: ["12 overdue tasks"],
      actions: [],
    }, facts)).toEqual({ ok: false, unsupportedNumbers: [12] });

    expect(validateDigestMessageAgainstFacts({
      headline: "72% readiness",
      priorities: ["6 high risks"],
      actions: [],
    }, facts)).toEqual({ ok: false, unsupportedNumbers: [6] });

    expect(validateDigestMessageAgainstFacts({
      headline: "72% readiness",
      priorities: ["72% readiness", "7 open tasks", "12 evidence items", "2 high risks"],
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
      github,
    });

    expect(validateDigestMessageAgainstFacts({
      headline: "72% readiness",
      priorities: ["Review ISO 27001 renewal", "Control A.8.1 is disabled"],
      actions: ["Review ISO 27001 renewal"],
    }, facts)).toEqual({ ok: true });

    expect(validateDigestMessageAgainstFacts({
      headline: "72% readiness",
      priorities: ["Complete by 2026-08-04", "Control A.9.1 needs review", "80% readiness"],
      actions: [],
    }, facts)).toEqual({ ok: false, unsupportedNumbers: [4, 8, 9.1, 80, 2026] });
  });

  it("accepts only the documented returned literal field types", () => {
    const facts = buildDailyDigestFacts({
      workspace: { id: "00000000-0000-4000-8000-000000000001", name: "Internal ISMS" },
      localDate: "2026-08-06", overview,
      attentionItems: [{
        id: "task:task-27001", category: "overdue_task", severity: "high",
        summary: "Review ISO 27001 renewal", dueOn: "2026-08-05",
        observedOn: "2026-08-04T09:00:00Z", source: "task",
      }],
      monitoringFindings: [{
        id: "monitoring_finding:finding-a", severity: "critical", status: "open",
        title: "Control A.8.1 is disabled", controlRef: "A.8.1",
        detectedAt: "2026-08-06T06:00:00Z",
      }],
      latestLeadershipReport: { id: "report-1", publishedAt: "2026-08-05T16:00:00Z" },
      github,
    });

    expect(validateDigestMessageAgainstFacts({
      headline: facts.workspace.name,
      priorities: [facts.localDate, facts.attentionItems[0]!.id, facts.attentionItems[0]!.summary, facts.attentionItems[0]!.dueOn!, facts.attentionItems[0]!.observedOn!],
      actions: [facts.monitoringFindings[0]!.id, facts.monitoringFindings[0]!.title, facts.monitoringFindings[0]!.controlRef!, facts.monitoringFindings[0]!.detectedAt, facts.latestLeadershipReport!.id],
    }, facts)).toEqual({ ok: true });
    expect(validateDigestMessageAgainstFacts({
      headline: facts.latestLeadershipReport!.publishedAt, priorities: [], actions: [],
    }, facts)).toEqual({ ok: true });

    for (const line of ["critical", "open", "high", "task", "overdue_task"]) {
      expect(validateDigestMessageAgainstFacts({ headline: "72% readiness", priorities: [line], actions: [] }, facts).ok).toBe(false);
    }
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
      headline: "72% readiness",
      priorities: [],
      actions: [],
    }, { workspaceName: "Internal ISMS", localDate: "2026-08-06" });

    const rendered = JSON.stringify(payload);
    expect(rendered).not.toContain("None reported");
    expect(rendered).toContain("Priorities");
    expect(rendered).toContain("Actions");
  });
});
