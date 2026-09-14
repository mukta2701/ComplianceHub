import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATIONS = `${process.cwd()}/supabase/migrations`;
const PG_TAP_V2 = `${process.cwd()}/supabase/tests/database/079_mcp_github_official_results_v2.sql`;
const LAST_PUBLISHED_MIGRATION = "20260901131747_github_official_monitoring_reads.sql";

function successorMigration() {
  const candidates = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql") && name > LAST_PUBLISHED_MIGRATION)
    .map((name) => ({ name, sql: readFileSync(`${MIGRATIONS}/${name}`, "utf8") }))
    .filter(({ sql }) => sql.includes("get_mcp_github_compliance_results_v2"));
  expect(candidates).toHaveLength(1);
  return candidates[0]!;
}

describe("GitHub official MCP v2 successor migration", () => {
  it("adds one v2-only successor after the published monitoring boundary", () => {
    const { name, sql } = successorMigration();
    const v2 = sql.slice(sql.indexOf("create function public.get_mcp_github_compliance_results_v2"));

    expect(name).toMatch(/^2026\d{10}_mcp_github_official_results_v2\.sql$/);
    expect(sql).toMatch(/create\s+function\s+public\.get_mcp_github_compliance_results_v2\s*\(/i);
    expect(v2).toMatch(/github_official_compliance_results[\s\S]*github_observations[\s\S]*github_collection_runs[\s\S]*run_mode\s*=\s*'official'[\s\S]*status\s+in\s*\(\s*'succeeded'\s*,\s*'partial'\s*\)[\s\S]*completed_at\s+is\s+not\s+null/i);
    expect(v2.indexOf("run_mode = 'official'")).toBeLessThan(v2.indexOf("row_number() over"));
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.get_mcp_github_compliance_results_v2[\s\S]*grant\s+execute\s+on\s+function\s+public\.get_mcp_github_compliance_results_v2[\s\S]*to\s+authenticated/i);
  });

  it("does not change v1, digest, materialisation, lifecycle enforcement, or application data", () => {
    const { sql } = successorMigration();

    expect(sql).not.toMatch(/get_mcp_github_compliance_results_v1/i);
    expect(sql).not.toMatch(/get_mcp_compliance_bundle_v2/i);
    expect(sql).not.toMatch(/materialise_github_observations/i);
    expect(sql).not.toMatch(/(?:create|alter|drop)\s+trigger/i);
    expect(sql).not.toMatch(/require_github_official_result_eligible_run/i);
    expect(sql).not.toMatch(/grant\s+select\s*\([^)]*\)\s+on\s+public\./i);
    expect(sql).not.toMatch(/\b(?:insert\s+into|update|delete\s+from)\s+public\./i);
  });

  it("rejects an explicit null v2 limit before the result query", () => {
    const { sql } = successorMigration();
    const v2 = sql.slice(sql.indexOf("create function public.get_mcp_github_compliance_results_v2"));

    expect(v2).toMatch(/if\s+target_limit\s+is\s+null[\s\S]*raise exception 'invalid GitHub compliance result filters'/i);
    expect(v2.indexOf("target_limit is null")).toBeLessThan(v2.indexOf("with eligible as materialized"));
  });

  it("keeps the cursor key and compare helper private while authenticating the v2 definer from exact MCP JWT claims", () => {
    const { sql } = successorMigration();
    const pgTap = readFileSync(PG_TAP_V2, "utf8");
    const v2 = sql.slice(sql.indexOf("create function public.get_mcp_github_compliance_results_v2"));

    expect(sql).not.toContain("pg_catalog.coalesce(");
    expect(pgTap).not.toContain("pg_catalog.coalesce(");
    expect(sql).toMatch(/create\s+schema\s+mcp_cursor_private\s+authorization\s+postgres/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+schema\s+mcp_cursor_private\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role\s*,\s*supabase_auth_admin/i);
    expect(sql).not.toMatch(/revoke\s+all\s+on\s+schema\s+private/i);
    expect(sql).toMatch(/create\s+table\s+mcp_cursor_private\.mcp_github_results_cursor_key[\s\S]*octet_length\s*\([^)]*key_bytes[^)]*\)\s*=\s*32/i);
    expect(sql).toMatch(/insert\s+into\s+mcp_cursor_private\.mcp_github_results_cursor_key[\s\S]*extensions\.gen_random_bytes\s*\(\s*32\s*\)/i);
    expect(sql).toMatch(/alter\s+table\s+mcp_cursor_private\.mcp_github_results_cursor_key\s+owner\s+to\s+postgres/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+(?:table\s+)?mcp_cursor_private\.mcp_github_results_cursor_key\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role\s*,\s*supabase_auth_admin/i);
    expect(sql).toMatch(/create\s+(?:or\s+replace\s+)?function\s+mcp_cursor_private\.mcp_github_cursor_bytes_equal[\s\S]*set\s+search_path\s*=\s*''/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+mcp_cursor_private\.mcp_github_cursor_bytes_equal[\s\S]*supabase_auth_admin/i);
    expect(v2).toMatch(/stable[\s\S]*security\s+definer[\s\S]*set\s+search_path\s*=\s*''/i);
    expect(v2).toMatch(/auth\.uid\s*\(\s*\)[\s\S]*auth\.role\s*\(\s*\)[\s\S]*client_id[\s\S]*private\.mcp_oauth_config[\s\S]*aud/i);
    expect(v2).toContain("^[A-Za-z0-9._~-]{1,200}$");
  });

  it("uses only HMAC-protected ch3 database cursors with fixed lifetime bindings and truthful page kind", () => {
    const { sql } = successorMigration();
    const v2 = sql.slice(sql.indexOf("create function public.get_mcp_github_compliance_results_v2"));

    expect(v2).toMatch(/\^ch3[\s\S]*extensions\.hmac[\s\S]*mcp_cursor_private\.mcp_github_cursor_bytes_equal/i);
    expect(v2).toMatch(/char_length\s*\(\s*target_cursor\s*\)\s+not\s+between\s+80\s+and\s+2048[\s\S]*target_cursor\s*!~\s*'\^ch3\[\.\]\[A-Za-z0-9_-\]\+\[\.\]\[0-9a-f\]\{64\}\$'/i);
    expect(v2).not.toContain("{1,1900}");
    expect(v2).not.toMatch(/\^ch2|return\s+'ch2\.|next_cursor\s*:=\s*'ch2\./i);
    expect(v2).toMatch(/userId[\s\S]*clientId[\s\S]*audience[\s\S]*organisationId[\s\S]*filters[\s\S]*issuedAt[\s\S]*expiresAt/i);
    expect(v2).toMatch(/interval\s+'15 minutes'/i);
    expect(v2).toMatch(/'pageKind'[\s\S]*case\s+when\s+target_cursor\s+is\s+null\s+then\s+'initial'\s+else\s+'continuation'/i);
    expect(v2).toMatch(/'pageHash'[\s\S]*compliancehub\.github\.page\.v2/i);
  });
});
