import { z } from "zod";
import { jiraConnectionTargetSchema } from "@/features/integrations/application/connection";
import type { CheckResult, MonitorConnection, MonitorProvider } from "../domain/monitor-provider";

export type JiraGetResponse = {
  status: number;
  data: unknown;
};

// The port deliberately has no method parameter: monitoring callers can only
// request a bounded GET through the server adapter.
export type JiraGetRequest = (
  pathSegments: readonly string[],
  query: Readonly<Record<string, string | number>>,
) => Promise<JiraGetResponse>;

const cloudIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const issueIdPattern = /^[1-9][0-9]{0,39}$/;
const issueKeyPattern = /^[A-Z][A-Z0-9_]{0,79}-[1-9][0-9]{0,19}$/;
const maxResults = 50;
const maxIssuesPerCheck = 500;
const maxPagesPerCheck = 10;

const safeText = z.string().trim().min(1).max(255).refine((value) => !/[\r\n]/.test(value));
// Jira Cloud serialises date-times with both ISO `+00:00` and RFC 822-style
// `+0000` offsets. Keep the shape bounded and validate that it denotes a real
// instant instead of relying on Zod's narrower ISO-only offset parser.
const jiraDateTime = z.string().min(20).max(64)
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/)
  .refine((value) => Number.isFinite(Date.parse(value)));
const prioritySchema = z.object({
  id: z.string().max(40).optional(),
  name: safeText,
  description: z.string().max(2_000).optional(),
  statusColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  isDefault: z.boolean().optional(),
  avatarId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  self: z.string().url().max(2_048).optional(),
  iconUrl: z.string().min(1).max(2_048).refine((value) => {
    if (value.startsWith("/")) return !/[\r\n]/.test(value);
    try {
      const url = new URL(value);
      return url.protocol === "https:";
    } catch {
      return false;
    }
  }).optional(),
}).strict();
const issueSchema = z.object({
  id: z.string().regex(issueIdPattern),
  key: z.string().regex(issueKeyPattern),
  expand: z.string().max(1_000).optional(),
  self: z.string().url().max(2_048).optional(),
  fields: z.object({
    duedate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    updated: jiraDateTime,
    priority: prioritySchema.nullable(),
  }).strict(),
}).strict();
const issuePageSchema = z.object({
  isLast: z.boolean(),
  nextPageToken: z.string().min(1).max(2_048).refine((value) => !/[\r\n]/.test(value)).optional(),
  issues: z.array(issueSchema).max(maxResults),
  warnings: z.array(z.unknown()).max(100).optional(),
  warningMessages: z.array(z.string().max(1_000)).max(100).optional(),
  names: z.record(z.string().max(255), z.string().max(255))
    .refine((value) => Object.keys(value).length <= 500).optional(),
  schema: z.record(z.string().max(255), z.unknown())
    .refine((value) => Object.keys(value).length <= 500).optional(),
}).strict();

type JiraIssue = z.infer<typeof issueSchema>;

type CheckDefinition = {
  checkId: string;
  controlRef: string;
  severity: CheckResult["severity"];
  jql: (projectKey: string) => string;
  healthyTitle: string;
  reviewTitle: (issueKey: string) => string;
  detail: (projectKey: string, issue: JiraIssue) => string;
};

const definitions: readonly CheckDefinition[] = [
  {
    checkId: "jira.overdue_unresolved",
    controlRef: "A.5.24",
    severity: "high",
    jql: (project) => `project = "${project}" AND resolution = EMPTY AND due < now() ORDER BY key ASC`,
    healthyTitle: "No overdue unresolved issues found",
    reviewTitle: (key) => `${key} overdue unresolved issue requires review`,
    detail: (project, issue) => `${issue.key} in ${project} is unresolved with due date ${issue.fields.duedate ?? "not exposed"}; review the remediation timeline.`,
  },
  {
    checkId: "jira.unassigned_high_priority",
    controlRef: "A.5.24",
    severity: "high",
    jql: (project) => `project = "${project}" AND resolution = EMPTY AND priority in (Highest, High) AND assignee is EMPTY ORDER BY key ASC`,
    healthyTitle: "No unassigned high-priority unresolved issues found",
    reviewTitle: (key) => `${key} unassigned high-priority issue requires review`,
    detail: (project, issue) => `${issue.key} in ${project} is unresolved, ${issue.fields.priority?.name ?? "high priority"}, and unassigned; review ownership.`,
  },
  {
    checkId: "jira.stale_unresolved",
    controlRef: "A.5.24",
    severity: "medium",
    jql: (project) => `project = "${project}" AND resolution = EMPTY AND updated <= -30d ORDER BY key ASC`,
    healthyTitle: "No stale unresolved issues found",
    reviewTitle: (key) => `${key} stale unresolved issue requires review`,
    detail: (project, issue) => `${issue.key} in ${project} is unresolved and was last updated ${issue.fields.updated}; review whether it is still active.`,
  },
];

async function listIssues(input: {
  request: JiraGetRequest;
  projectKey: string;
  definition: CheckDefinition;
}): Promise<JiraIssue[]> {
  const issues: JiraIssue[] = [];
  const seen = new Set<string>();
  const seenPageTokens = new Set<string>();
  let nextPageToken: string | undefined;

  for (let pageNumber = 0; pageNumber < maxPagesPerCheck; pageNumber += 1) {
    const query: Record<string, string | number> = {
      jql: input.definition.jql(input.projectKey),
      fields: "duedate,updated,priority",
      maxResults,
    };
    if (nextPageToken) query.nextPageToken = nextPageToken;
    const response = await input.request(["search", "jql"], query);
    if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
      throw new Error("Jira issue monitoring failed");
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("Jira issue monitoring is unavailable with the granted scopes");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Jira issue monitoring failed: ${response.status}`);
    }

    const parsed = issuePageSchema.safeParse(response.data);
    if (!parsed.success) throw new Error("Jira returned invalid issue monitoring data");
    if ((parsed.data.warnings?.length ?? 0) > 0 || (parsed.data.warningMessages?.length ?? 0) > 0) {
      throw new Error("Jira issue monitoring snapshot is incomplete");
    }
    for (const issue of parsed.data.issues) {
      if (seen.has(issue.id) || seen.has(issue.key)) {
        throw new Error("Jira returned duplicate issue monitoring data");
      }
      seen.add(issue.id);
      seen.add(issue.key);
      issues.push(issue);
    }
    if (issues.length > maxIssuesPerCheck) {
      throw new Error("Jira returned too many issues to monitor safely");
    }
    if (parsed.data.isLast) {
      if (parsed.data.nextPageToken) throw new Error("Jira returned invalid issue monitoring data");
      return issues;
    }
    if (!parsed.data.nextPageToken) {
      throw new Error("Jira returned invalid issue monitoring data");
    }
    if (seenPageTokens.has(parsed.data.nextPageToken)) {
      throw new Error("Jira returned invalid issue pagination data");
    }
    seenPageTokens.add(parsed.data.nextPageToken);
    if (issues.length >= maxIssuesPerCheck) {
      throw new Error("Jira returned too many issues to monitor safely");
    }
    nextPageToken = parsed.data.nextPageToken;
  }

  throw new Error("Jira returned too many issue pages to monitor safely");
}

function checksFor(
  definition: CheckDefinition,
  cloudId: string,
  projectKey: string,
  issues: JiraIssue[],
): CheckResult[] {
  if (issues.length === 0) {
    return [{
      checkId: definition.checkId,
      controlRef: definition.controlRef,
      subjectType: "jira_project",
      subjectId: `${cloudId}:${projectKey}`,
      passed: true,
      severity: definition.severity,
      title: definition.healthyTitle,
      detail: `Jira returned no matching unresolved issues in ${projectKey}.`,
    }];
  }
  return issues.map((issue) => ({
    checkId: definition.checkId,
    controlRef: definition.controlRef,
    subjectType: "jira_issue",
    subjectId: `${cloudId}:${issue.key}`,
    passed: false,
    severity: definition.severity,
    title: definition.reviewTitle(issue.key),
    detail: definition.detail(projectKey, issue),
  }));
}

export function createJiraMonitorProvider(input: { request: JiraGetRequest }): MonitorProvider {
  if (typeof input.request !== "function") throw new Error("Jira monitoring is unavailable");
  return {
    async runChecks(connection: MonitorConnection) {
      if (connection.provider !== "jira") throw new Error("Jira monitoring connection is invalid");
      const target = jiraConnectionTargetSchema.parse({
        provider: "jira",
        baseUrl: connection.config.baseUrl,
        projectKey: connection.config.projectKey,
      });
      const cloudId = connection.config.cloudId;
      if (typeof cloudId !== "string" || !cloudIdPattern.test(cloudId)) {
        throw new Error("Jira monitoring target is invalid");
      }

      const output: CheckResult[] = [];
      for (const definition of definitions) {
        const issues = await listIssues({ request: input.request, projectKey: target.projectKey, definition });
        output.push(...checksFor(definition, cloudId, target.projectKey, issues));
      }
      return output;
    },
  };
}
