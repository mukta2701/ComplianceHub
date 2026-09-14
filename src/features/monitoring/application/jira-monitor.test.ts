import { describe, expect, it, vi } from "vitest";
import type { MonitorConnection } from "../domain/monitor-provider";
import { createJiraMonitorProvider, type JiraGetRequest } from "./jira-monitor";

const jiraCloudId = "1324a887-45db-4bf4-8e99-ef0ff456d421";
const jiraIssueSubject = `${jiraCloudId}:SEC-42`;

const connection: MonitorConnection = {
  id: "source-2",
  provider: "jira",
  config: {
    baseUrl: "https://acme.atlassian.net",
    cloudId: jiraCloudId,
    projectKey: "SEC",
  },
  connectionMode: "jira_oauth",
};

function emptyPage() {
  return { isLast: true, issues: [] };
}

function issue(overrides: Record<string, unknown> = {}) {
  return {
    id: "10001",
    key: "SEC-42",
    fields: {
      duedate: "2026-07-01",
      updated: "2026-05-01T09:00:00.000Z",
      priority: { name: "Highest" },
      ...overrides,
    },
  };
}

describe("Jira read-only compliance monitor", () => {
  it("reports overdue, unassigned high-priority, and stale unresolved issues as review signals", async () => {
    const request = vi.fn<JiraGetRequest>(async (_path, query) => ({
      status: 200,
      data: { isLast: true, issues: [issue()] },
      request: query,
    }));

    const checks = await createJiraMonitorProvider({ request }).runChecks(connection);

    expect(checks.map((check) => [check.checkId, check.subjectId, check.passed])).toEqual([
      ["jira.overdue_unresolved", jiraIssueSubject, false],
      ["jira.unassigned_high_priority", jiraIssueSubject, false],
      ["jira.stale_unresolved", jiraIssueSubject, false],
    ]);
    expect(checks.every((check) => /requires review/i.test(check.title))).toBe(true);
    expect(checks.every((check) => check.detail.includes("SEC-42") && check.detail.includes("SEC"))).toBe(true);
    expect(JSON.stringify(checks)).not.toMatch(/non[- ]?compliant/i);
    expect(request).toHaveBeenCalledTimes(3);
    for (const [path, query] of request.mock.calls) {
      expect(path).toEqual(["search", "jql"]);
      expect(query).toEqual(expect.objectContaining({ maxResults: 50 }));
      expect(query.fields).toBe("duedate,updated,priority");
      expect(query).not.toHaveProperty("startAt");
      expect(String(query.jql)).toContain('project = "SEC"');
      expect(JSON.stringify([path, query])).not.toMatch(/method|post|put|patch|delete|write:jira-work/i);
    }
  });

  it("accepts Jira Cloud timestamps whose UTC offset omits the colon", async () => {
    const request = vi.fn<JiraGetRequest>(async () => ({
      status: 200,
      data: {
        isLast: true,
        issues: [issue({ updated: "2026-05-01T09:00:00.000+0000" })],
      },
    }));

    await expect(createJiraMonitorProvider({ request }).runChecks(connection))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ checkId: "jira.stale_unresolved", subjectId: jiraIssueSubject }),
      ]));
  });

  it("accepts the documented Jira priority fields returned with issues", async () => {
    const request = vi.fn<JiraGetRequest>(async () => ({
      status: 200,
      data: {
        isLast: true,
        issues: [issue({
          priority: {
            id: "1",
            name: "Highest",
            description: "Highest operational urgency.",
            statusColor: "#d04437",
            iconUrl: "https://acme.atlassian.net/images/icons/priorities/highest.svg",
            self: "https://api.atlassian.com/ex/jira/1324a887-45db-4bf4-8e99-ef0ff456d421/rest/api/3/priority/1",
          },
        })],
      },
    }));

    await expect(createJiraMonitorProvider({ request }).runChecks(connection))
      .resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ checkId: "jira.unassigned_high_priority", subjectId: jiraIssueSubject }),
      ]));
  });

  it("accepts empty documented metadata but fails closed on a warned incomplete snapshot", async () => {
    const documented = vi.fn<JiraGetRequest>(async () => ({
      status: 200,
      data: {
        isLast: true,
        issues: [],
        warnings: [],
        names: { summary: "Summary" },
        schema: { summary: { type: "string", system: "summary" } },
      },
    }));

    await expect(createJiraMonitorProvider({ request: documented }).runChecks(connection))
      .resolves.toHaveLength(3);

    const warned = vi.fn<JiraGetRequest>(async () => ({
      status: 200,
      data: {
        isLast: true,
        issues: [],
        warnings: [{
          type: "issueLimit",
          message: "The result set was truncated.",
          details: { actual: 5_001, limit: 5_000 },
        }],
      },
    }));
    await expect(createJiraMonitorProvider({ request: warned }).runChecks(connection))
      .rejects.toThrow("Jira issue monitoring snapshot is incomplete");

    const unknown = vi.fn<JiraGetRequest>(async () => ({
      status: 200,
      data: { isLast: true, issues: [], unexpected: true },
    }));
    await expect(createJiraMonitorProvider({ request: unknown }).runChecks(connection))
      .rejects.toThrow("Jira returned invalid issue monitoring data");
  });

  it("emits passing project-level checks when no matching issues exist", async () => {
    const request = vi.fn<JiraGetRequest>(async () => ({ status: 200, data: emptyPage() }));

    const checks = await createJiraMonitorProvider({ request }).runChecks(connection);

    expect(checks).toEqual([
      expect.objectContaining({ checkId: "jira.overdue_unresolved", subjectType: "jira_project", subjectId: `${jiraCloudId}:SEC`, passed: true }),
      expect.objectContaining({ checkId: "jira.unassigned_high_priority", subjectType: "jira_project", subjectId: `${jiraCloudId}:SEC`, passed: true }),
      expect.objectContaining({ checkId: "jira.stale_unresolved", subjectType: "jira_project", subjectId: `${jiraCloudId}:SEC`, passed: true }),
    ]);
  });

  it("paginates by continuation token with fixed row and page bounds", async () => {
    const pages = [
      { isLast: false, nextPageToken: "page-2", issues: Array.from({ length: 50 }, (_, index) => ({ ...issue(), id: String(10_000 + index), key: `SEC-${index + 1}` })) },
      { isLast: true, issues: [{ ...issue(), id: "10099", key: "SEC-51" }] },
      emptyPage(),
      emptyPage(),
    ];
    const request = vi.fn<JiraGetRequest>(async () => ({ status: 200, data: pages.shift() }));

    const checks = await createJiraMonitorProvider({ request }).runChecks(connection);

    expect(checks.filter((check) => check.checkId === "jira.overdue_unresolved")).toHaveLength(51);
    expect(request.mock.calls[0]?.[1]).not.toHaveProperty("nextPageToken");
    expect(request.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ nextPageToken: "page-2" }));

    let page = 0;
    const excessive = vi.fn<JiraGetRequest>(async () => {
      page += 1;
      return {
        status: 200,
        data: {
          isLast: false,
          nextPageToken: `page-${page + 1}`,
          issues: Array.from({ length: 50 }, (_, index) => ({
            ...issue(),
            id: String(page * 1_000 + index + 1),
            key: `SEC-${page * 1_000 + index + 1}`,
          })),
        },
      };
    });
    await expect(createJiraMonitorProvider({ request: excessive }).runChecks(connection))
      .rejects.toThrow("Jira returned too many issues to monitor safely");
    expect(excessive).toHaveBeenCalledTimes(10);
  });

  it("rejects malformed pages, duplicate issues, and provider failures", async () => {
    const malformed = vi.fn<JiraGetRequest>(async () => ({
      status: 200,
      data: { isLast: true, issues: [], unexpected: true },
    }));
    await expect(createJiraMonitorProvider({ request: malformed }).runChecks(connection))
      .rejects.toThrow("Jira returned invalid issue monitoring data");

    const duplicatePages = [
      { isLast: false, nextPageToken: "page-2", issues: [issue()] },
      { isLast: true, issues: [issue()] },
    ];
    const duplicate = vi.fn<JiraGetRequest>(async () => ({ status: 200, data: duplicatePages.shift() }));
    await expect(createJiraMonitorProvider({ request: duplicate }).runChecks(connection))
      .rejects.toThrow("Jira returned duplicate issue monitoring data");

    const unavailable = vi.fn<JiraGetRequest>(async () => ({ status: 403, data: {} }));
    await expect(createJiraMonitorProvider({ request: unavailable }).runChecks(connection))
      .rejects.toThrow("Jira issue monitoring is unavailable with the granted scopes");
  });
});
