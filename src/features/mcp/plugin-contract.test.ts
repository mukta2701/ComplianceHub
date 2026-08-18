import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateDigestMessageAgainstFacts, type DailyDigestFacts } from "./domain/digest";
import { MCP_SERVER_INSTRUCTIONS } from "./server/server";

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

describe("private ComplianceHub plugin safety contract", () => {
  it("makes prepare-only the default and requires explicit delivery intent", () => {
    const skill = read("plugins/compliancehub-internal/skills/daily-compliance-brief/SKILL.md");
    const manifest = JSON.parse(read("plugins/compliancehub-internal/.codex-plugin/plugin.json")) as {
      interface: { defaultPrompt: string[] };
    };
    const openAi = read("plugins/compliancehub-internal/skills/daily-compliance-brief/agents/openai.yaml");

    expect(skill).toMatch(/decide delivery intent before calling any tool/i);
    expect(skill).toMatch(/prepare-only[\s\S]*zero calls to `post_daily_digest`/i);
    expect(skill).toMatch(/draft[\s\S]*review[\s\S]*do not post/i);
    expect(skill).toMatch(/explicit(?:ly)? (?:asks? to )?(?:send|post|deliver)/i);
    expect(skill).toMatch(/Owner role[\s\S]*not sufficient/i);
    expect(skill).toMatch(/ordinary chat[\s\S]*scheduled[\s\S]*not enough/i);
    expect(skill).toMatch(/`delivery_failed`[\s\S]*continue composing[\s\S]*PREPARE-ONLY/i);
    expect(manifest.interface.defaultPrompt[0]).toMatch(/without posting/i);
    expect(manifest.interface.defaultPrompt.length).toBeLessThanOrEqual(3);
    expect(openAi).toMatch(/default_prompt:.*without posting/i);
  });

  it("gives every MCP client the same write-intent boundary", () => {
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/prepare-only[\s\S]*zero calls to post_daily_digest/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/explicit(?:ly)?[^.]{0,40}(?:send|post|deliver)[\s\S]*trusted hosted scheduled/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/Authorization to send[\s\S]*not sufficient/i);
    expect(MCP_SERVER_INSTRUCTIONS).not.toMatch(/Summarize evidence and policies/i);
    expect(MCP_SERVER_INSTRUCTIONS).toMatch(/singular[^.]*<N>[^.]*1[^.]*plural/i);
  });

  it("documents composition forms that the server accepts", () => {
    const skill = read("plugins/compliancehub-internal/skills/daily-compliance-brief/SKILL.md");

    expect(skill).toMatch(/exact returned fact literal/i);
    expect(skill).toMatch(/<N>% readiness/);
    expect(skill).toMatch(/<N> overdue task[\s\S]*<N> overdue tasks/);
    expect(skill).toMatch(/<N> very-high risk[\s\S]*<N> very-high risks/);
    expect(skill).toMatch(/review\|address\|resolve\|investigate\|prioritize\|prioritise/);
    expect(skill).toMatch(/one fact per line/i);
    expect(skill).toMatch(/120 characters[\s\S]*240 characters/i);
    expect(skill).toMatch(/singular[\s\S]*<N>.*1[\s\S]*plural/i);

    const facts: DailyDigestFacts = {
      schemaVersion: 1,
      workspace: { id: "10000000-0000-4000-8000-000000000001", name: "Internal ISMS" },
      localDate: "2026-08-07",
      overview: {
        soaPercent: 72, soaTotal: 10, tasksOpen: 7, tasksOverdue: 2,
        evidence: { total: 12, expiring: 1, expired: 0 },
        riskBands: { very_high: 1, high: 2, moderate: 3, low: 4 },
        openAudits: 1, openNonConformities: 3,
      },
      attentionItems: [{
        id: "policy:10000000-0000-4000-8000-000000000002", source: "policy",
        category: "policy_review", severity: "high", summary: "Review ISO 27001 renewal",
      }],
      monitoringFindings: [{
        id: "monitoring_finding:10000000-0000-4000-8000-000000000003",
        severity: "critical", status: "open", title: "Secret scanning disabled",
        detectedAt: "2026-08-07T06:00:00.000Z",
      }],
      latestLeadershipReport: null,
      truncation: { attentionItems: false, monitoringFindings: false },
    };
    expect(validateDigestMessageAgainstFacts({
      headline: "72% readiness",
      priorities: ["10 SoA controls", "7 open tasks", "2 overdue tasks", "12 evidence items", "1 expiring evidence"],
      actions: ["review 3 open non-conformities", "address 1 very-high risk", "resolve 2 high risks", "investigate 1 open audit", "prioritize 0 expired evidence"],
    }, facts)).toEqual({ ok: true });
    expect(validateDigestMessageAgainstFacts({
      headline: "Secret scanning disabled", priorities: ["Review ISO 27001 renewal"], actions: [],
    }, facts)).toEqual({ ok: true });
  });

  it("enumerates every exact returned literal field for all MCP clients", () => {
    const skill = read("plugins/compliancehub-internal/skills/daily-compliance-brief/SKILL.md");
    const literalFields = [
      "workspace.name", "localDate",
      "attentionItems[].id", "attentionItems[].summary", "attentionItems[].dueOn", "attentionItems[].observedOn",
      "monitoringFindings[].id", "monitoringFindings[].title", "monitoringFindings[].controlRef", "monitoringFindings[].detectedAt",
      "latestLeadershipReport.id", "latestLeadershipReport.publishedAt",
    ];
    for (const field of literalFields) {
      expect(skill).toContain(`\`${field}\``);
      expect(MCP_SERVER_INSTRUCTIONS).toContain(field);
    }
  });

  it("packages the registered private app and keeps deployment schedules synchronized", () => {
    const appMap = JSON.parse(read("plugins/compliancehub-internal/.app.json")) as { apps: object };
    const deployment = read("docs/deployment.md");
    const workflow = read(".github/workflows/ci.yml");
    const maintenanceWorkflow = read(".github/workflows/azure-maintenance.yml");
    const vercel = JSON.parse(read("vercel.json")) as { crons?: Array<{ path: string; schedule: string }> };

    expect(appMap.apps).toEqual({
      compliancehub: { id: "asdk_app_6a82f504a814819182e544ececddefc9" },
    });
    expect(deployment).toMatch(/registered private application[\s\S]*asdk_app_6a82f504a814819182e544ececddefc9/i);
    expect(deployment).toMatch(/`POST \/api\/cron\/daily`[^\n]*`7 6 \* \* \*`[^\n]*06:07 UTC/i);
    expect(deployment).toMatch(/`POST \/api\/cron\/monitor`[^\n]*`13 7 \* \* \*`[^\n]*07:13 UTC/i);
    expect(deployment).toMatch(/integration sync[\s\S]*folded into[\s\S]*daily pipeline/i);
    expect(workflow.match(/version: 2\.109\.0/g)).toHaveLength(2);
    expect(workflow).not.toMatch(/version: latest/);
    expect(maintenanceWorkflow).toMatch(/cron: ["']7 6 \* \* \*["']/);
    expect(maintenanceWorkflow).toMatch(/cron: ["']13 7 \* \* \*["']/);
    expect(maintenanceWorkflow).toMatch(/cron: ["']29 7 \* \* \*["']/);
    expect(maintenanceWorkflow).toMatch(/cron: ["']29 5 \* \* \*["']/);
    expect(maintenanceWorkflow).toMatch(/options:[\s\S]*- github-collect/);
    expect(maintenanceWorkflow).toMatch(/options:[\s\S]*- automation-purge/);
    expect(maintenanceWorkflow).toMatch(/Unknown maintenance (?:route|schedule)/);
    expect(deployment).toMatch(/`POST \/api\/cron\/github-collect`.*`29 5 \* \* \*`.*05:29 UTC/i);
    expect(deployment).toMatch(/`POST \/api\/cron\/automation-purge`.*`29 7 \* \* \*`.*07:29 UTC/i);
    expect(vercel.crons ?? []).toEqual([]);
  });
});
