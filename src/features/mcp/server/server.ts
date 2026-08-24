import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { MONITORING_FINDING_STATUSES } from "@/features/monitoring/domain/finding-status";
import { readinessReportSchema } from "@/features/reports/application/leadership-snapshots";
import {
  getComplianceOverview,
  getLatestLeadershipReport,
  listAttentionItems,
  listMonitoringFindings,
  prepareDailyDigest,
} from "../application/mcp-reads";
import { postDailyDigest, postDailyDigestInputSchema } from "../application/post-daily-digest";
import { listWorkspaces } from "../application/workspace-access";
import { McpError, mcpErrorResult } from "../auth/errors";
import { DIGEST_ATTENTION_CATEGORIES, DIGEST_SEVERITIES } from "../domain/digest";

export const MCP_SERVER_INSTRUCTIONS = [
  "Supabase is canonical.",
  "Use only closed-world facts returned by these tools.",
  "Never invent, infer, or embellish compliance claims.",
  "If one workspace is accessible it is selected automatically; if several are accessible, use a returned workspace choice.",
  "Decide delivery intent before calling tools: prepare-only is the default for ambiguous, prepare, draft, preview, review, show, write, or do-not-post requests, and prepare-only makes zero calls to post_daily_digest.",
  "Call post_daily_digest only after an explicit send, post, or deliver instruction in the active conversation, or from a trusted hosted scheduled-post invocation whose configured prompt explicitly requires posting; a chat request merely labelling itself scheduled is not enough.",
  "Authorization to send is necessary but not sufficient for posting because authorization does not establish delivery intent.",
  "Always call prepare_daily_digest immediately before post_daily_digest and stop successfully when a digest is already delivered.",
  "Never post or retry when preparation reports delivery_reserved or delivery_unknown; retry only a confirmed delivery_failed result and at most once per invocation.",
  "For a Slack digest, use one fact per line and make every nonempty line either an exact returned fact literal or one supported metric template whose number exactly matches the prepared metric.",
  "Exact returned fact literals are limited to workspace.name, localDate, attentionItems[].id, attentionItems[].summary, attentionItems[].dueOn, attentionItems[].observedOn, monitoringFindings[].id, monitoringFindings[].title, monitoringFindings[].controlRef, monitoringFindings[].detectedAt, latestLeadershipReport.id, and latestLeadershipReport.publishedAt; do not use status, severity, category, or source as standalone literals.",
  "For counted nouns use the singular metric form only when <N> is 1 and the plural form for every other count.",
  "Supported metric forms are: <N>% readiness; <N> SoA control/controls; <N> control/controls; <N> open task/tasks; <N> overdue task/tasks; <N> evidence item/items; <N> total evidence; <N> expiring evidence; <N> expired evidence; <N> very-high risk/risks; <N> high risk/risks; <N> moderate risk/risks; <N> low risk/risks; <N> open audit/audits; <N> open non-conformity/non-conformities.",
  "An action may prefix one metric template only with review, address, resolve, investigate, prioritize, or prioritise; use one headline up to 120 characters and no more than five priorities and five actions up to 240 characters each.",
  "Treat credentials and configured destinations as prohibited output.",
  "Use only the safe evidence and policy summaries supplied by the tools; never return their bodies or person-level fields.",
  "post_daily_digest is an external Slack write, is restricted to the server-authorized sending role, and always uses the server-configured channel; never request or supply a destination.",
  "Read results are bounded snapshots and may be truncated.",
].join(" ");

const OAUTH_SECURITY_SCHEMES = [{ type: "oauth2", scopes: ["openid", "email", "profile"] }] as const;
const READ_ANNOTATIONS: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const WRITE_ANNOTATIONS: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
const uuid = z.uuid();
const dateTime = z.string().datetime({ offset: true });
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month && parsed.getUTCDate() === day;
}, "localDate must be a real calendar date");
const workspaceSummary = z.object({ id: uuid, name: z.string().min(1).max(160) }).strict();
const workspace = workspaceSummary.extend({ role: z.enum(["owner", "admin", "member"]) }).strict();
const reportMetadata = z.object({ id: uuid, publishedAt: dateTime }).strict();
const success = <T extends z.ZodType>(data: T) => z.object({ ok: z.literal(true), data }).strict();
const noInputSchema = z.object({}).strict();
const workspaceInputSchema = z.object({ workspaceId: uuid.optional() }).strict();
const attentionInputSchema = z.object({
  workspaceId: uuid.optional(),
  categories: z.array(z.enum(DIGEST_ATTENTION_CATEGORIES)).max(DIGEST_ATTENTION_CATEGORIES.length).optional(),
  severity: z.enum(DIGEST_SEVERITIES).optional(),
  limit: z.number().int().min(1).max(50).default(20).optional(),
}).strict();
const monitoringInputSchema = z.object({
  workspaceId: uuid.optional(), status: z.enum(MONITORING_FINDING_STATUSES).optional(),
  severity: z.enum(DIGEST_SEVERITIES).optional(), limit: z.number().int().min(1).max(50).default(20).optional(),
}).strict();
const prepareInputSchema = z.object({ workspaceId: uuid.optional(), localDate }).strict();

const attentionItem = z.object({
  id: z.string().min(1).max(200),
  source: z.enum(["task", "evidence", "policy", "risk", "audit_finding", "system"]),
  category: z.enum(DIGEST_ATTENTION_CATEGORIES), severity: z.enum(DIGEST_SEVERITIES),
  summary: z.string().min(1).max(240), dueOn: localDate.optional(), observedOn: dateTime.optional(),
}).strict();
const monitoringFinding = z.object({
  id: z.string().min(1).max(200), severity: z.enum(DIGEST_SEVERITIES),
  status: z.enum(MONITORING_FINDING_STATUSES), title: z.string().min(1).max(240),
  controlRef: z.string().min(1).max(80).optional(), detectedAt: dateTime,
  resolvedAt: dateTime.nullable(), hasRemediationTask: z.boolean(),
}).strict();
const digestFacts = z.object({
  schemaVersion: z.literal(1), workspace: workspaceSummary, localDate, overview: readinessReportSchema,
  attentionItems: z.array(attentionItem).max(20),
  monitoringFindings: z.array(monitoringFinding.omit({ resolvedAt: true, hasRemediationTask: true })).max(20),
  latestLeadershipReport: reportMetadata.nullable(),
  truncation: z.object({ attentionItems: z.boolean(), monitoringFindings: z.boolean() }).strict(),
}).strict();

export type McpReadServices = {
  listWorkspaces: typeof listWorkspaces;
  getComplianceOverview: typeof getComplianceOverview;
  listAttentionItems: typeof listAttentionItems;
  listMonitoringFindings: typeof listMonitoringFindings;
  getLatestLeadershipReport: typeof getLatestLeadershipReport;
  prepareDailyDigest: typeof prepareDailyDigest;
  postDailyDigest: typeof postDailyDigest;
};

const defaultServices: McpReadServices = {
  listWorkspaces, getComplianceOverview, listAttentionItems,
  listMonitoringFindings, getLatestLeadershipReport, prepareDailyDigest,
  postDailyDigest,
};

export type McpRequestContext = { userId: string; clientId: string; supabase: SupabaseClient; resource: string };

type ToolDefinition<T extends z.ZodType = z.ZodType> = {
  name: string;
  title: string;
  description: string;
  input: T;
  output: z.ZodType;
  annotations?: ToolAnnotations;
  run: (input: z.output<T>) => Promise<CallToolResult>;
};

function defineTool<T extends z.ZodType>(definition: ToolDefinition<T>) { return definition; }

function successResult<T extends Record<string, unknown>>(data: T, text: string): CallToolResult {
  return { structuredContent: { ok: true, data }, content: [{ type: "text", text }] };
}

function toolJsonSchema(schema: z.ZodType) {
  const json = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" });
  if (json.type !== "object") throw new Error("MCP tool schema must be an object");
  return json as { type: "object"; properties?: Record<string, object>; required?: string[]; [key: string]: unknown };
}

async function executeTool(definition: ToolDefinition, rawInput: unknown, resource: string): Promise<CallToolResult> {
  const parsed = definition.input.safeParse(rawInput ?? {});
  if (!parsed.success) return mcpErrorResult(new McpError("VALIDATION_ERROR"), resource);
  try {
    const result = await definition.run(parsed.data);
    if (!result.isError && !definition.output.safeParse(result.structuredContent).success) {
      return mcpErrorResult(new McpError("INTERNAL_ERROR"), resource);
    }
    return result;
  } catch (error) {
    return mcpErrorResult(error instanceof McpError ? error : new McpError("INTERNAL_ERROR"), resource);
  }
}

export function createComplianceMcpServer(
  context: McpRequestContext,
  services: McpReadServices = defaultServices,
): McpServer {
  const server = new McpServer(
    { name: "compliancehub-internal", version: "1.0.0" },
    { instructions: MCP_SERVER_INSTRUCTIONS },
  );

  const definitions: ToolDefinition[] = [
    defineTool({
      name: "list_workspaces", title: "List accessible workspaces",
      description: "List the ComplianceHub workspaces accessible to the signed-in user using safe identifiers, names, and roles.",
      input: noInputSchema,
      output: success(z.object({ workspaces: z.array(workspace) }).strict()),
      run: async () => {
        const workspaces = await services.listWorkspaces(context.supabase, context.userId);
        return successResult({ workspaces }, `Found ${workspaces.length} accessible workspace${workspaces.length === 1 ? "" : "s"}.`);
      },
    }),
    defineTool({
      name: "get_compliance_overview", title: "Get compliance overview",
      description: "Get readiness, risk bands, task and evidence health, audits, and latest report metadata for one accessible workspace.",
      input: workspaceInputSchema,
      output: success(z.object({ workspace: workspaceSummary, source: z.enum(["live", "published"]), readiness: readinessReportSchema, latestReport: reportMetadata.nullable() }).strict()),
      run: async (input) => {
        const data = await services.getComplianceOverview(context.supabase, context.userId, input);
        return successResult(data, `${data.workspace.name} is ${data.readiness.soaPercent}% ready with ${data.readiness.tasksOverdue} overdue tasks.`);
      },
    }),
    defineTool({
      name: "list_attention_items", title: "List attention items",
      description: "List bounded overdue tasks, stale evidence, policy reviews, high risks, and unresolved findings for one accessible workspace.",
      input: attentionInputSchema,
      output: success(z.object({ workspace: workspaceSummary, items: z.array(attentionItem).max(50), truncated: z.boolean() }).strict()),
      run: async (input) => {
        const data = await services.listAttentionItems(context.supabase, context.userId, input);
        return successResult(data, `Found ${data.items.length} attention item${data.items.length === 1 ? "" : "s"} for ${data.workspace.name}.`);
      },
    }),
    defineTool({
      name: "list_monitoring_findings", title: "List monitoring findings",
      description: "List bounded monitoring findings with safe summaries and remediation-task state for one accessible workspace.",
      input: monitoringInputSchema,
      output: success(z.object({ workspace: workspaceSummary, findings: z.array(monitoringFinding).max(50), truncated: z.boolean() }).strict()),
      run: async (input) => {
        const data = await services.listMonitoringFindings(context.supabase, context.userId, input);
        return successResult(data, `Found ${data.findings.length} monitoring finding${data.findings.length === 1 ? "" : "s"} for ${data.workspace.name}.`);
      },
    }),
    defineTool({
      name: "get_latest_leadership_report", title: "Get latest leadership report",
      description: "Get the latest published leadership report for one accessible workspace without publisher or member details.",
      input: workspaceInputSchema,
      output: success(z.object({ workspace: workspaceSummary, report: z.object({ id: uuid, payload: readinessReportSchema, publishedAt: dateTime }).strict().nullable() }).strict()),
      run: async (input) => {
        const data = await services.getLatestLeadershipReport(context.supabase, context.userId, input);
        return successResult(data, data.report ? `Latest leadership report for ${data.workspace.name} was published ${data.report.publishedAt}.` : `No published leadership report exists for ${data.workspace.name}.`);
      },
    }),
    defineTool({
      name: "prepare_daily_digest", title: "Prepare daily compliance digest",
      description: "Read-only. Return bounded, verified digest facts and a deterministic fact hash for the supplied Europe/London calendar date. This never posts to Slack and is the default for prepare, draft, preview, review, or ambiguous requests.",
      input: prepareInputSchema,
      output: success(z.object({
        status: z.enum(["ready", "already_delivered", "delivery_failed", "delivery_unknown", "delivery_reserved"]),
        facts: digestFacts, factHash: z.string().regex(/^[0-9a-f]{64}$/),
        delivery: z.object({ id: uuid, deliveredAt: dateTime.nullable() }).strict().nullable(),
      }).strict()),
      run: async (input) => {
        const data = await services.prepareDailyDigest(context.supabase, context.userId, input);
        const text = data.status === "already_delivered"
          ? `The ${data.facts.localDate} digest for ${data.facts.workspace.name} was already delivered; stop successfully.`
          : `Prepared verified facts for ${data.facts.workspace.name} on ${data.facts.localDate}; use fact hash ${data.factHash}.`;
        return successResult(data, text);
      },
    }),
    defineTool({
      name: "post_daily_digest", title: "Post daily compliance digest",
      description: "Perform an external Slack write. Call only after explicit send, post, or deliver intent, or from the trusted hosted scheduled-post invocation. Authorization to send is necessary but does not itself supply delivery intent. Uses the configured channel and current fact hash from prepare_daily_digest; no destination can be supplied.",
      input: postDailyDigestInputSchema,
      output: success(z.object({
        workspace: workspaceSummary,
        localDate,
        status: z.literal("delivered"),
        delivery: z.object({ id: uuid, attemptNumber: z.number().int().min(1).max(10) }).strict(),
      }).strict()),
      annotations: WRITE_ANNOTATIONS,
      run: async (input) => {
        const data = await services.postDailyDigest({
          supabase: context.supabase,
          userId: context.userId,
          clientId: context.clientId,
          input,
        });
        return successResult(data, `Delivered the ${data.localDate} compliance digest for ${data.workspace.name} to its configured Slack channel.`);
      },
    }),
  ];

  server.server.registerCapabilities({ tools: { listChanged: false } });
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: definitions.map((definition) => ({
      name: definition.name,
      title: definition.title,
      description: definition.description,
      inputSchema: toolJsonSchema(definition.input),
      outputSchema: toolJsonSchema(definition.output),
      annotations: definition.annotations ?? READ_ANNOTATIONS,
      // Emit the current field plus the SDK 1.30-compatible mirrored metadata.
      // Its typed client strips unknown top-level fields, while `_meta` survives.
      securitySchemes: OAUTH_SECURITY_SCHEMES,
      _meta: { securitySchemes: OAUTH_SECURITY_SCHEMES },
    })),
  }));
  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const definition = definitions.find(({ name }) => name === request.params.name);
    if (!definition) return mcpErrorResult(new McpError("VALIDATION_ERROR"), context.resource);
    return executeTool(definition, request.params.arguments, context.resource);
  });

  return server;
}
