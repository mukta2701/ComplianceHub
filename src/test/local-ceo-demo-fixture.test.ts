// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertApprovedLocalCeoContainerIdentity,
  fixtureApplySql,
  fixtureTargetTableNames,
  fixtureVerifySql,
  historicalEvidenceSha256,
  localCeoContainerInspectArgs,
  localDockerExecutable,
  localDockerContextInspectArgs,
  parseFixtureMode,
  parseFixtureSummary,
  protectedTableNames,
  runLocalCeoDemoFixture,
} from "../../scripts/local-ceo-demo-fixture";

const sha256 = /^[0-9a-f]{64}$/;

describe("local CEO demo fixture guards", () => {
  it("exposes one explicit, local-only package command", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
    expect(packageJson.scripts["demo:ceo-fixture"])
      .toBe("node --import=tsx scripts/local-ceo-demo-fixture.ts");
  });

  it("accepts only apply or verify mode", () => {
    expect(parseFixtureMode([])).toBe("apply");
    expect(parseFixtureMode(["--verify"])).toBe("verify");
    for (const args of [["--apply"], ["--verify", "extra"], ["--help"]]) {
      expect(() => parseFixtureMode(args)).toThrow("Local CEO demo fixture preflight failed");
    }
  });

  it("binds execution to the exact local Supabase database container", () => {
    expect(localDockerContextInspectArgs()).toEqual([
      "context", "inspect", "colima", "--format", "{{(index .Endpoints \"docker\").Host}}",
    ]);
    expect(localCeoContainerInspectArgs()).toEqual([
      "inspect",
      "--format",
      "{{.State.Running}}|{{index .Config.Labels \"com.supabase.cli.project\"}}|{{index .Config.Labels \"com.docker.compose.project\"}}|{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}|{{.Config.WorkingDir}}|{{.Config.Image}}",
      "supabase_db_compliancehub",
    ]);
    expect(() => assertApprovedLocalCeoContainerIdentity(
      "unix:///Users/m1ghty/.colima/default/docker.sock",
      "true|compliancehub|compliancehub|supabase_network_compliancehub |/|public.ecr.aws/supabase/postgres:15.8.1.085",
    )).not.toThrow();
    for (const value of [
      "false|compliancehub|compliancehub|supabase_network_compliancehub |/|public.ecr.aws/supabase/postgres:15.8.1.085",
      "true|hosted|compliancehub|supabase_network_compliancehub |/|public.ecr.aws/supabase/postgres:15.8.1.085",
      "true|compliancehub|other|supabase_network_compliancehub |/|public.ecr.aws/supabase/postgres:15.8.1.085",
      "true|compliancehub|compliancehub|other_network |/|public.ecr.aws/supabase/postgres:15.8.1.085",
      "true|compliancehub|compliancehub|supabase_network_compliancehub |/tmp|public.ecr.aws/supabase/postgres:15.8.1.085",
    ]) expect(() => assertApprovedLocalCeoContainerIdentity(
      "unix:///Users/m1ghty/.colima/default/docker.sock",
      value,
    )).toThrow("Local CEO demo fixture preflight failed");
    expect(() => assertApprovedLocalCeoContainerIdentity(
      "tcp://remote.example:2376",
      "true|compliancehub|compliancehub|supabase_network_compliancehub |/|public.ecr.aws/supabase/postgres:15.8.1.085",
    )).toThrow("Local CEO demo fixture preflight failed");
  });

  it("uses a closed target registry and forbids protected integrations and evidence", () => {
    expect(fixtureTargetTableNames).toEqual([
      "assessment_sessions", "assessment_responses", "soa_registers", "soa_items",
      "risks", "tasks", "policies", "policy_acceptances", "audits", "audit_findings",
      "kpis", "kpi_measurements", "notifications", "leadership_report_snapshots",
    ]);
    expect(protectedTableNames).toEqual(expect.arrayContaining([
      "github_installations", "github_repositories", "github_collection_runs", "github_observations",
      "github_mapping_packs", "github_mapping_entries", "github_mapping_approvals",
      "github_official_compliance_results", "github_evidence_provenance", "github_finding_provenance",
      "github_finding_transitions", "github_materialisation_jobs", "github_webhook_deliveries",
      "monitoring_findings", "integration_connections", "evidence_sources", "alert_channels",
      "daily_digest_deliveries", "daily_digest_delivery_attempts", "evidence", "evidence_links",
      "monitor_sources", "github_oauth_states",
    ]));
    expect(fixtureTargetTableNames).not.toContain("risk_categories");
    expect(fixtureTargetTableNames).not.toContain("evidence");
    expect(fixtureTargetTableNames).not.toContain("monitoring_findings");
  });

  it("is transactional, locked, collision-failing, and preservation-checking", () => {
    expect(fixtureApplySql).toContain("BEGIN;");
    expect(fixtureApplySql).toContain("pg_advisory_xact_lock");
    expect(fixtureApplySql).toContain("Fixture collision detected");
    expect(fixtureApplySql).toContain("Persistent state changed outside the fixture registry");
    expect(fixtureApplySql).toContain("Protected integration state changed");
    expect(fixtureApplySql).toContain("Unexpected audit event delta");
    expect(fixtureApplySql).toContain("Phase 2 pilot baseline precondition failed");
    expect(fixtureApplySql).toContain("OVERRIDING SYSTEM VALUE");
    expect(fixtureApplySql).toContain("COMMIT;");
    expect(fixtureVerifySql).toContain("BEGIN TRANSACTION READ ONLY;");
    expect(fixtureVerifySql).toContain("COMMIT;");
  });

  it("validates the newest terminal official GitHub generation instead of global history cardinality", () => {
    for (const sql of [fixtureApplySql, fixtureVerifySql]) {
      expect(sql).toMatch(/github_installations[\s\S]*status='active'[\s\S]*permissions_ok[\s\S]*revoked_at IS NULL/);
      expect(sql).toMatch(/github_repositories[\s\S]*selected[\s\S]*available[\s\S]*NOT repository\.archived[\s\S]*removed_at IS NULL/);
      expect(sql).toMatch(/github_collection_runs[\s\S]*run_mode='official'[\s\S]*status IN \('succeeded','partial','failed','rate_limited'\)[\s\S]*ORDER BY completed_at DESC, id DESC[\s\S]*LIMIT 1/);
      expect(sql).not.toContain("(SELECT count(*) FROM public.github_collection_runs WHERE organisation_id=org_id) <> 1");
      expect(sql).not.toContain("(SELECT count(*) FROM public.github_observations WHERE organisation_id=org_id) <> 15");
      expect(sql).not.toContain("(SELECT count(*) FROM public.github_official_compliance_results WHERE organisation_id=org_id) <> 15");
    }
  });

  it("rejects an incomplete, stale, or incorrectly mapped newest GitHub snapshot", () => {
    for (const sql of [fixtureApplySql, fixtureVerifySql]) {
      expect(sql).toContain("latest_run_status IS DISTINCT FROM 'partial'");
      expect(sql).toContain("latest_run_observation_count <> 15");
      expect(sql).toContain("latest_run_passed_count <> 8");
      expect(sql).toContain("latest_run_failed_count <> 5");
      expect(sql).toContain("latest_run_unknown_count <> 2");
      expect(sql).toContain("latest_run_not_applicable_count <> 0");
      expect(sql).toMatch(/count\(DISTINCT result\.check_id\)[\s\S]*github_official_compliance_results result[\s\S]*result\.collection_run_id=latest_run_id[\s\S]*<> 15/);
      expect(sql).toContain("result.fresh_until <= statement_timestamp()");
      expect(sql).toContain("result.approval_id IS DISTINCT FROM active_approval_id");
      expect(sql).toContain("result.mapping_pack_id IS DISTINCT FROM active_mapping_pack_id");
      expect(sql).toContain("entry.check_id IS NULL");
      expect(sql).toContain("result.outcome='pass' AND result.evidence_id IS NULL");
      expect(sql).toContain("result.outcome='fail' AND (result.evidence_id IS NOT NULL OR result.finding_id IS NULL)");
      expect(sql).toMatch(/result\.outcome IN \('unknown','not_applicable'\)[\s\S]*result\.evidence_id IS NOT NULL OR result\.finding_id IS NOT NULL/);
    }
  });

  it("requires exactly the latest pass-derived live evidence and latest fail-derived open findings", () => {
    for (const sql of [fixtureApplySql, fixtureVerifySql]) {
      expect(sql).toMatch(/count\(\*\) FROM public\.evidence evidence[\s\S]*status IN \('current','expiring'\)[\s\S]*valid_until >= current_date\) <> 8/);
      expect(sql).toMatch(/NOT EXISTS \([\s\S]*public\.evidence live_evidence[\s\S]*NOT EXISTS \([\s\S]*latest_result\.evidence_id=live_evidence\.id/);
      expect(sql).toContain("provenance.observation_id IS DISTINCT FROM result.observation_id");
      expect(sql).toContain("provenance.collection_run_id IS DISTINCT FROM latest_run_id");
      expect(sql).toMatch(/count\(\*\) FROM public\.monitoring_findings finding[\s\S]*finding\.status='open'\) <> 5/);
      expect(sql).toContain("finding_provenance.latest_observation_id IS DISTINCT FROM result.observation_id");
      expect(sql).toContain("finding_provenance.latest_collection_run_id IS DISTINCT FROM latest_run_id");
      expect(sql).not.toContain("(SELECT count(*) FROM public.evidence WHERE organisation_id=org_id) <> 8");
      expect(sql).not.toContain("(SELECT count(*) FROM public.monitoring_findings WHERE organisation_id=org_id) <> 5");
    }
  });

  it("allows prior immutable generations only when their run, observation, mapping, and supersession lineage is valid", () => {
    for (const sql of [fixtureApplySql, fixtureVerifySql]) {
      expect(sql).toMatch(/FROM public\.github_official_compliance_results historical_result[\s\S]*historical_run\.run_mode IS DISTINCT FROM 'official'/);
      expect(sql).toContain("historical_run.status NOT IN ('succeeded','partial')");
      expect(sql).toContain("historical_observation.id IS NULL");
      expect(sql).toContain("historical_pack.id IS NULL");
      expect(sql).toContain("historical_entry.id IS NULL");
      expect(sql).toMatch(/public\.github_evidence_provenance historical_provenance[\s\S]*historical_evidence\.replaces_evidence_id IS DISTINCT FROM historical_provenance\.supersedes_evidence_id/);
      expect(sql).toMatch(/historical_provenance\.supersedes_evidence_id IS NOT NULL[\s\S]*superseded_provenance\.identity_key IS DISTINCT FROM historical_provenance\.identity_key/);
      expect(sql).toContain("historical_evidence.status='superseded'");
      expect(sql).toContain("successor_provenance.supersedes_evidence_id=historical_provenance.evidence_id");
      expect(sql).not.toContain("(SELECT count(*) FROM public.github_evidence_provenance WHERE organisation_id=org_id) <> 8");
      expect(sql).not.toContain("(SELECT count(*) FROM public.evidence_links WHERE organisation_id=org_id) <> 15");
    }
  });

  it("never mutates protected tables or calls external services", () => {
    const source = readFileSync(join(process.cwd(), "scripts/local-ceo-demo-fixture.ts"), "utf8");
    for (const table of protectedTableNames) {
      expect(source).not.toMatch(new RegExp(`(?:insert\\s+into|update|delete\\s+from|truncate)\\s+(?:public\\.)?${table}\\b`, "i"));
    }
    expect(source).not.toMatch(/(?:insert\s+into|update|delete\s+from|truncate)\s+(?:public\.)?risk_categories\b/i);
    expect(source).not.toMatch(/api\.github\.com|hooks\.slack\.com|postDailyDigest|fetch\s*\(/i);
    expect(source).not.toMatch(/process\.env|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL/i);
    expect(localDockerExecutable).toBe("/opt/homebrew/bin/docker");
    expect(source).not.toContain('execFileSync("docker"');
  });

  it("retains the frozen Phase 2 proof artifact hash", () => {
    expect(historicalEvidenceSha256).toBe("79e66498f58fee76966e9119fbd138911dbc8b2c8f5ac1775e423ed8e9449a30");
  });

  it("accepts only one redacted JSON summary", () => {
    const digest = "a".repeat(64);
    const parsed = parseFixtureSummary(`${JSON.stringify({
      ok: true,
      mode: "verified",
      fixtureVersion: "ceo-demo-v1",
      fixtureRecords: 30,
      auditEventsAdded: 0,
      counts: {
        assessmentSessions: 1, assessmentResponses: 3, soaRegisters: 1, soaItems: 4,
        risks: 2, tasks: 4, policies: 2, policyAcceptances: 1, audits: 1,
        auditFindings: 1, kpis: 2, kpiMeasurements: 4, notifications: 3,
        leadershipReports: 1,
      },
      fixtureSha256: digest,
      protectedSha256: digest,
      existingRowsSha256: digest,
      artifactSha256: historicalEvidenceSha256,
    })}\n`);
    expect(parsed.ok).toBe(true);
    expect(parsed.fixtureSha256).toMatch(sha256);
    expect(() => parseFixtureSummary("not-json\n")).toThrow("Local CEO demo fixture preflight failed");
    expect(() => parseFixtureSummary("{}\n{}\n")).toThrow("Local CEO demo fixture preflight failed");
    expect(() => parseFixtureSummary(`${JSON.stringify({ ...parsed, mode: "created", auditEventsAdded: 0 })}\n`))
      .toThrow("Local CEO demo fixture preflight failed");
    expect(() => parseFixtureSummary(`${JSON.stringify({ ...parsed, mode: "verified", auditEventsAdded: 30 })}\n`))
      .toThrow("Local CEO demo fixture preflight failed");
  });
});

describe.runIf(process.env.RUN_LOCAL_CEO_FIXTURE === "1")("local CEO demo fixture integration", () => {
  it("creates the bounded fixture, then proves a byte-semantic idempotent rerun", () => {
    const first = runLocalCeoDemoFixture("apply");
    const second = runLocalCeoDemoFixture("apply");
    const verified = runLocalCeoDemoFixture("verify");

    expect(first.fixtureRecords).toBe(30);
    expect(second.mode).toBe("unchanged");
    expect(second.auditEventsAdded).toBe(0);
    expect(verified.mode).toBe("verified");
    expect(second.fixtureSha256).toBe(first.fixtureSha256);
    expect(verified.fixtureSha256).toBe(first.fixtureSha256);
    expect(second.protectedSha256).toBe(first.protectedSha256);
    expect(verified.protectedSha256).toBe(first.protectedSha256);
    expect(second.existingRowsSha256).toBe(first.existingRowsSha256);
    expect(verified.existingRowsSha256).toBe(first.existingRowsSha256);
  }, 60_000);

  it("rolls back a synthetic natural-key collision without changing protected or existing rows", () => {
    const before = runLocalCeoDemoFixture("verify");
    expect(() => runLocalCeoDemoFixture("apply", { injectCollisionForTest: true }))
      .toThrow("Local CEO demo fixture preflight failed");
    const after = runLocalCeoDemoFixture("verify");
    expect(after.fixtureSha256).toBe(before.fixtureSha256);
    expect(after.protectedSha256).toBe(before.protectedSha256);
    expect(after.existingRowsSha256).toBe(before.existingRowsSha256);
  }, 30_000);
});
