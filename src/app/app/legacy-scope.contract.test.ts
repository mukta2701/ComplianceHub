import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.join(process.cwd(), "src/app/app");

const scopedQueries = [
  ["page.tsx", "risk_matrix_config"],
  ["assessment/page.tsx", "assessment_sessions"],
  ["assessment/[id]/page.tsx", "assessment_sessions"],
  ["assessment/[id]/page.tsx", "assessment_responses"],
  ["assets/page.tsx", "assets"],
  ["assets/[id]/page.tsx", "assets"],
  ["assets/[id]/page.tsx", "asset_risks"],
  ["assets/[id]/page.tsx", "risks"],
  ["assets/[id]/edit/page.tsx", "assets"],
  ["assets/[id]/edit/page.tsx", "memberships"],
  ["evidence/page.tsx", "evidence"],
  ["evidence/new/page.tsx", "memberships"],
  ["risks/page.tsx", "risks"],
  ["risks/page.tsx", "assessment_responses"],
  ["risks/page.tsx", "tasks"],
  ["risks/page.tsx", "evidence_links"],
  ["risks/page.tsx", "risk_matrix_config"],
  ["risks/[id]/page.tsx", "risks"],
  ["risks/[id]/page.tsx", "risk_treatment_plans"],
  ["risks/[id]/page.tsx", "risk_matrix_config"],
  ["risks/[id]/page.tsx", "memberships"],
  ["tasks/page.tsx", "tasks"],
  ["tasks/[id]/page.tsx", "tasks"],
  ["tasks/[id]/page.tsx", "risks"],
  ["tasks/[id]/page.tsx", "evidence_links"],
  ["tasks/[id]/page.tsx", "task_tickets"],
  ["tasks/new/page.tsx", "memberships"],
  ["tasks/new/page.tsx", "risks"],
  ["tasks/from-gap/page.tsx", "memberships"],
  ["kpis/page.tsx", "kpis"],
  ["kpis/page.tsx", "memberships"],
  ["kpis/page.tsx", "kpi_measurements"],
  ["audits/page.tsx", "audits"],
  ["audits/page.tsx", "audit_findings"],
  ["audits/[id]/page.tsx", "audits"],
  ["audits/[id]/page.tsx", "audit_checklist_items"],
  ["audits/[id]/page.tsx", "audit_findings"],
  ["audits/[id]/page.tsx", "memberships"],
  ["audits/[id]/page.tsx", "auditor_access_tokens"],
  ["audits/new/page.tsx", "memberships"],
  ["activity/page.tsx", "audit_events"],
] as const;

describe("legacy protected pages keep organisation-owned reads in the active workspace", () => {
  it.each(scopedQueries)("%s scopes %s by organisation_id", (relativePath, table) => {
    const source = readFileSync(path.join(root, relativePath), "utf8");
    const tableCall = new RegExp(
      "supabase\\.from\\(\\\"" + table + "\\\"\\)[\\s\\S]{0,500}?\\.eq\\(\\\"organisation_id\\\", organisation\\.id\\)",
    );
    expect(source).toMatch(tableCall);
  });
});

const scopedMutations = [
  ["actions.ts", "risks", "delete", "id"],
  ["actions.ts", "risks", "update", "id"],
  ["assets/actions.ts", "assets", "update", "id"],
  ["assets/actions.ts", "assets", "delete", "id"],
  ["assets/actions.ts", "asset_risks", "delete", "asset_id"],
  ["tasks/actions.ts", "tasks", "update", "id"],
] as const;

describe("legacy server mutations pin IDs to the active workspace", () => {
  it.each(scopedMutations)("%s scopes %s %s by organisation_id", (relativePath, table, operation, key) => {
    const source = readFileSync(path.join(root, relativePath), "utf8");
    const tableCall = new RegExp(
      "supabase\\.from\\(\\\"" + table + "\\\"\\)[\\s\\S]{0,700}?\\." + operation + "\\([\\s\\S]{0,700}?\\.eq\\(\\\"" + key + "\\\",[\\s\\S]{0,700}?\\.eq\\(\\\"organisation_id\\\", organisation\\.id\\)",
    );
    expect(source).toMatch(tableCall);
  });
});

describe("audit pages and actions keep related reads in the active workspace", () => {
  it("scopes checklist position lookup by both audit and organisation", () => {
    const source = readFileSync(path.join(root, "audits/actions.ts"), "utf8");
    expect(source).toMatch(/from\("audit_checklist_items"\)[\s\S]{0,500}?\.eq\("audit_id", parsed\.auditId\)[\s\S]{0,500}?\.eq\("organisation_id", organisation\.id\)/);
  });

  it("scopes the detail page's auditor token list to the organisation and selected-audit or organisation-wide scope", () => {
    const source = readFileSync(path.join(root, "audits/[id]/page.tsx"), "utf8");
    expect(source).toMatch(/from\("auditor_access_tokens"\)[\s\S]{0,500}?\.eq\("organisation_id", organisation\.id\)/);
    expect(source).toContain(".or(`audit_id.eq.${id},audit_id.is.null`)");
  });
});

describe("active-workspace reference and AI reads are explicit", () => {
  it("pins risk suggestion reference lookups to the active organisation", () => {
    const source = readFileSync(path.join(root, "actions.ts"), "utf8");
    expect(source).toMatch(/from\("assessment_responses"\)[\s\S]{0,350}?\.eq\("organisation_id", organisation\.id\)[\s\S]{0,250}?\.eq\("session_id", sessionId\)[\s\S]{0,180}?\.eq\("question_id", questionId\)/);
    expect(source).toMatch(/from\("risks"\)[\s\S]{0,120}?\.select\("reference"\)[\s\S]{0,120}?\.eq\("organisation_id", organisation\.id\)/);
    expect(source).toMatch(/from\("risk_categories"\)[\s\S]{0,220}?\.eq\("name", "Readiness"\)\.eq\("organisation_id", organisation\.id\)/);
  });

  it("pins assessment and SoA AI target reads to the active organisation", () => {
    const source = readFileSync(path.join(process.cwd(), "src/app/api/app/ai/route.ts"), "utf8");
    expect(source).toMatch(/from\("assessment_sessions"\)[\s\S]{0,300}?\.eq\("organisation_id", organisation\.id\)/);
    expect(source).toMatch(/from\("assessment_responses"\)[\s\S]{0,350}?\.eq\("organisation_id", organisation\.id\)/);
    expect(source).toMatch(/from\("soa_items"\)[\s\S]{0,300}?\.eq\("organisation_id", organisation\.id\)/);
  });
});
