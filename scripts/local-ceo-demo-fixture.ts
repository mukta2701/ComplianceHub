import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

const failure = () => new Error("Local CEO demo fixture preflight failed");
export const localDockerExecutable = "/opt/homebrew/bin/docker";
const localContainer = "supabase_db_compliancehub";
const localDockerContext = "colima";
const localDockerEndpoint = "unix:///Users/m1ghty/.colima/default/docker.sock";
const expectedContainerIdentity = "true|compliancehub|compliancehub|supabase_network_compliancehub |/|public.ecr.aws/supabase/postgres:15.8.1.085";
const phase2ArtifactPath = "artifacts/phase2-local-mcp-github-read-proof.json";

export const historicalEvidenceSha256 = "79e66498f58fee76966e9119fbd138911dbc8b2c8f5ac1775e423ed8e9449a30";

export const fixtureTargetTableNames = [
  "assessment_sessions", "assessment_responses", "soa_registers", "soa_items",
  "risks", "tasks", "policies", "policy_acceptances", "audits", "audit_findings",
  "kpis", "kpi_measurements", "notifications", "leadership_report_snapshots",
] as const;

export const protectedTableNames = [
  "github_installations", "github_repositories", "github_collection_runs", "github_observations",
  "github_mapping_packs", "github_mapping_entries", "github_mapping_approvals",
  "github_official_compliance_results", "github_evidence_provenance", "github_finding_provenance",
  "github_finding_transitions", "github_materialisation_jobs", "github_webhook_deliveries",
  "github_oauth_states", "monitor_sources",
  "monitoring_findings", "integration_connections", "evidence_sources", "alert_channels",
  "daily_digest_deliveries", "daily_digest_delivery_attempts", "evidence", "evidence_links",
] as const;

export type FixtureMode = "apply" | "verify";

export function parseFixtureMode(args: string[]): FixtureMode {
  if (args.length === 0) return "apply";
  if (args.length === 1 && args[0] === "--verify") return "verify";
  throw failure();
}

export function localDockerContextInspectArgs(): string[] {
  return ["context", "inspect", localDockerContext, "--format", "{{(index .Endpoints \"docker\").Host}}"];
}

export function localCeoContainerInspectArgs(): string[] {
  return [
    "inspect",
    "--format",
    "{{.State.Running}}|{{index .Config.Labels \"com.supabase.cli.project\"}}|{{index .Config.Labels \"com.docker.compose.project\"}}|{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}|{{.Config.WorkingDir}}|{{.Config.Image}}",
    localContainer,
  ];
}

export function assertApprovedLocalCeoContainerIdentity(endpoint: string, identity: string): void {
  if (endpoint.trim() !== localDockerEndpoint || identity.trim() !== expectedContainerIdentity) throw failure();
}

const countsSchema = z.object({
  assessmentSessions: z.literal(1),
  assessmentResponses: z.literal(3),
  soaRegisters: z.literal(1),
  soaItems: z.literal(4),
  risks: z.literal(2),
  tasks: z.literal(4),
  policies: z.literal(2),
  policyAcceptances: z.literal(1),
  audits: z.literal(1),
  auditFindings: z.literal(1),
  kpis: z.literal(2),
  kpiMeasurements: z.literal(4),
  notifications: z.literal(3),
  leadershipReports: z.literal(1),
}).strict();

const shaSchema = z.string().regex(/^[0-9a-f]{64}$/);
const summaryObjectSchema = z.object({
  ok: z.literal(true),
  mode: z.enum(["created", "unchanged", "verified"]),
  fixtureVersion: z.literal("ceo-demo-v1"),
  fixtureRecords: z.literal(30),
  auditEventsAdded: z.union([z.literal(0), z.literal(30)]),
  counts: countsSchema,
  fixtureSha256: shaSchema,
  protectedSha256: shaSchema,
  existingRowsSha256: shaSchema,
  artifactSha256: z.literal(historicalEvidenceSha256),
}).strict();

const summarySchema = summaryObjectSchema.superRefine((value, context) => {
  const expectedAuditEvents = value.mode === "created" ? 30 : 0;
  if (value.auditEventsAdded !== expectedAuditEvents) {
    context.addIssue({ code: "custom", message: "mode and audit event delta do not match" });
  }
});

export type FixtureSummary = z.infer<typeof summarySchema>;

export function parseFixtureSummary(output: string): FixtureSummary {
  const lines = output.replace(/\r/g, "").split("\n").filter((line) => line.length > 0);
  if (lines.length !== 1) throw failure();
  try {
    return summarySchema.parse(JSON.parse(lines[0]));
  } catch {
    throw failure();
  }
}

const databaseSummarySchema = summaryObjectSchema.omit({ artifactSha256: true }).superRefine((value, context) => {
  const expectedAuditEvents = value.mode === "created" ? 30 : 0;
  if (value.auditEventsAdded !== expectedAuditEvents) {
    context.addIssue({ code: "custom", message: "mode and audit event delta do not match" });
  }
});

function fixtureSql(mode: FixtureMode, injectCollisionForTest = false): string {
  const readOnly = mode === "verify" ? "BEGIN TRANSACTION READ ONLY;" : "BEGIN;";
  const collisionInjection = injectCollisionForTest ? `
    INSERT INTO public.tasks (id, organisation_id, title, detail, status, owner_id, due_on, recurrence, source, control_id, risk_id, policy_id, created_by, created_at, updated_at, evidence_id)
    VALUES ('73ffffff-ffff-4fff-8fff-ffffffffffff', org_id, 'Complete the privileged access review', 'Synthetic rollback probe', 'open', owner_id, '2026-09-04', NULL, 'manual', NULL, NULL, NULL, owner_id, '2026-09-03T09:00:00Z', '2026-09-03T09:00:00Z', NULL);
  ` : "";
  const mutation = mode === "apply" ? `
    IF presence_count = 0 THEN
      created_fixture := true;
      FOREACH table_name IN ARRAY insert_order LOOP
        IF table_name = 'notifications' THEN
          EXECUTE 'INSERT INTO public.notifications OVERRIDING SYSTEM VALUE SELECT populated.* FROM jsonb_array_elements($1) item CROSS JOIN LATERAL jsonb_populate_record(NULL::public.notifications, item->''row'') populated WHERE item->>''table'' = $2'
            USING expectations, table_name;
        ELSE
          EXECUTE format(
            'INSERT INTO public.%I SELECT populated.* FROM jsonb_array_elements($1) item CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%I, item->''row'') populated WHERE item->>''table'' = $2',
            table_name, table_name
          ) USING expectations, table_name;
        END IF;
      END LOOP;
    END IF;
  ` : `
    IF presence_count <> 30 THEN
      RAISE EXCEPTION 'Fixture verification failed';
    END IF;
  `;

  return String.raw`\pset footer off
${readOnly}
SET LOCAL search_path = pg_catalog, public, extensions;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '5s';
DO $fixture$
DECLARE
  org_id constant uuid := '274f943e-1297-4292-95f2-45a9836f256b';
  owner_id uuid;
  q_gov uuid; q_risk uuid; q_ops uuid;
  cc_51 uuid; cc_52 uuid; cc_518 uuid; cc_536 uuid;
  legacy_1 uuid; legacy_2 uuid; legacy_3 uuid; legacy_4 uuid;
  category_access uuid; category_vendor uuid;
  expectations jsonb;
  table_name text;
  ids text[];
  presence_count integer := 0;
  row_count bigint;
  state_hash text;
  state jsonb;
  expected_bundle jsonb := '{}'::jsonb;
  actual_bundle jsonb := '{}'::jsonb;
  existing_before jsonb := '{}'::jsonb;
  existing_after jsonb := '{}'::jsonb;
  protected_before jsonb := '{}'::jsonb;
  protected_after jsonb := '{}'::jsonb;
  protected_digest text;
  existing_digest text;
  fixture_digest text;
  semantic_manifest jsonb;
  audit_before_max bigint;
  audit_before_count bigint;
  audit_before_hash text;
  audit_added bigint;
  created_fixture boolean := false;
  target_tables constant text[] := ARRAY[${fixtureTargetTableNames.map((name) => `'${name}'`).join(",")}];
  insert_order constant text[] := ARRAY['assessment_sessions','assessment_responses','soa_registers','soa_items','risks','policies','policy_acceptances','tasks','audits','audit_findings','kpis','kpi_measurements','notifications','leadership_report_snapshots'];
  protected_tables constant text[] := ARRAY[${protectedTableNames.map((name) => `'${name}'`).join(",")}];
BEGIN
  PERFORM pg_advisory_xact_lock(7300300903);

  IF (SELECT count(*) FROM public.organisations WHERE id = org_id AND slug = 'compliancehub-local-demo' AND name = 'ComplianceHub Local Demo') <> 1 THEN
    RAISE EXCEPTION 'Target workspace precondition failed';
  END IF;
  SELECT (array_agg(user_id ORDER BY user_id))[1] INTO owner_id
  FROM public.memberships WHERE organisation_id = org_id AND role = 'owner';
  IF owner_id IS NULL OR (SELECT count(*) FROM public.memberships WHERE organisation_id = org_id AND role = 'owner') <> 1
    OR (SELECT count(*) FROM public.memberships WHERE organisation_id = org_id) <> 1 THEN
    RAISE EXCEPTION 'Target owner precondition failed';
  END IF;
  IF (SELECT jsonb_agg(jsonb_build_object('name', name, 'position', position) ORDER BY position)
      FROM public.risk_categories WHERE organisation_id = org_id)
      IS DISTINCT FROM '[{"name":"Data Security","position":0},{"name":"Physical Security","position":1},{"name":"Compliance","position":2},{"name":"Access Control","position":3},{"name":"Network Security","position":4},{"name":"Operational","position":5},{"name":"Third-Party/Vendor Risk","position":6}]'::jsonb THEN
    RAISE EXCEPTION 'Risk category precondition failed';
  END IF;

  SELECT (array_agg(id))[1] INTO q_gov FROM public.catalogue_questions WHERE catalogue_version_id = '00000000-0000-4000-8000-000000000001' AND code = 'GOV-01';
  SELECT (array_agg(id))[1] INTO q_risk FROM public.catalogue_questions WHERE catalogue_version_id = '00000000-0000-4000-8000-000000000001' AND code = 'RISK-01';
  SELECT (array_agg(id))[1] INTO q_ops FROM public.catalogue_questions WHERE catalogue_version_id = '00000000-0000-4000-8000-000000000001' AND code = 'OPS-01';
  SELECT (array_agg(id))[1] INTO cc_51 FROM public.control_catalogue_controls WHERE catalogue_version_id = '40000000-0000-4000-8000-000000000001' AND code = '5.1';
  SELECT (array_agg(id))[1] INTO cc_52 FROM public.control_catalogue_controls WHERE catalogue_version_id = '40000000-0000-4000-8000-000000000001' AND code = '5.2';
  SELECT (array_agg(id))[1] INTO cc_518 FROM public.control_catalogue_controls WHERE catalogue_version_id = '40000000-0000-4000-8000-000000000001' AND code = '5.18';
  SELECT (array_agg(id))[1] INTO cc_536 FROM public.control_catalogue_controls WHERE catalogue_version_id = '40000000-0000-4000-8000-000000000001' AND code = '5.36';
  SELECT (array_agg(id))[1] INTO legacy_1 FROM public.controls WHERE code = 'CH-001';
  SELECT (array_agg(id))[1] INTO legacy_2 FROM public.controls WHERE code = 'CH-002';
  SELECT (array_agg(id))[1] INTO legacy_3 FROM public.controls WHERE code = 'CH-003';
  SELECT (array_agg(id))[1] INTO legacy_4 FROM public.controls WHERE code = 'CH-004';
  SELECT id INTO category_access FROM public.risk_categories WHERE organisation_id = org_id AND name = 'Access Control';
  SELECT id INTO category_vendor FROM public.risk_categories WHERE organisation_id = org_id AND name = 'Third-Party/Vendor Risk';
  IF q_gov IS NULL OR q_risk IS NULL OR q_ops IS NULL OR cc_51 IS NULL OR cc_52 IS NULL OR cc_518 IS NULL OR cc_536 IS NULL
    OR legacy_1 IS NULL OR legacy_2 IS NULL OR legacy_3 IS NULL OR legacy_4 IS NULL OR category_access IS NULL OR category_vendor IS NULL THEN
    RAISE EXCEPTION 'Catalogue precondition failed';
  END IF;

  IF (SELECT count(*) FROM public.github_installations WHERE organisation_id=org_id) <> 1
    OR (SELECT count(*) FROM public.github_repositories WHERE organisation_id=org_id AND selected AND available) <> 1
    OR (SELECT count(*) FROM public.github_collection_runs WHERE organisation_id=org_id AND status='partial') <> 1
    OR (SELECT count(*) FROM public.github_collection_runs WHERE organisation_id=org_id) <> 1
    OR (SELECT count(*) FROM public.github_observations WHERE organisation_id=org_id) <> 15
    OR (SELECT count(*) FROM public.github_official_compliance_results WHERE organisation_id=org_id) <> 15
    OR (SELECT count(*) FROM public.monitoring_findings WHERE organisation_id=org_id AND status='open') <> 5
    OR (SELECT count(*) FROM public.monitoring_findings WHERE organisation_id=org_id) <> 5
    OR (SELECT count(*) FROM public.evidence WHERE organisation_id=org_id AND status='current') <> 8
    OR (SELECT count(*) FROM public.evidence WHERE organisation_id=org_id) <> 8
    OR (SELECT count(*) FROM public.github_evidence_provenance WHERE organisation_id=org_id) <> 8
    OR (SELECT count(*) FROM public.evidence_links WHERE organisation_id=org_id) <> 15
  THEN RAISE EXCEPTION 'Phase 2 pilot baseline precondition failed'; END IF;

  expectations := jsonb_build_array(
    jsonb_build_object('table','assessment_sessions','id','73000000-0000-4000-8000-000000000001','natural','CEO Demo ISO 27001 Gap Assessment','row',jsonb_build_object('id','73000000-0000-4000-8000-000000000001','organisation_id',org_id,'catalogue_version_id','00000000-0000-4000-8000-000000000001','title','CEO Demo ISO 27001 Gap Assessment','state','completed','revision',3,'created_by',owner_id,'completed_at','2026-09-03T08:30:00Z','created_at','2026-09-03T08:00:00Z','updated_at','2026-09-03T08:30:00Z')),
    jsonb_build_object('table','assessment_responses','id','73000000-0000-4000-8000-000000000101','natural','GOV-01','stable_refs',jsonb_build_object('question','GOV-01'),'row',jsonb_build_object('id','73000000-0000-4000-8000-000000000101','organisation_id',org_id,'session_id','73000000-0000-4000-8000-000000000001','question_id',q_gov,'answer','yes','evidence_note','Leadership objectives approved for the fictional demo workspace.','updated_by',owner_id,'updated_at','2026-09-03T08:20:00Z','catalogue_version_id','00000000-0000-4000-8000-000000000001')),
    jsonb_build_object('table','assessment_responses','id','73000000-0000-4000-8000-000000000102','natural','RISK-01','stable_refs',jsonb_build_object('question','RISK-01'),'row',jsonb_build_object('id','73000000-0000-4000-8000-000000000102','organisation_id',org_id,'session_id','73000000-0000-4000-8000-000000000001','question_id',q_risk,'answer','partially','evidence_note','Risk method exists; quarterly review cadence is being embedded.','updated_by',owner_id,'updated_at','2026-09-03T08:22:00Z','catalogue_version_id','00000000-0000-4000-8000-000000000001')),
    jsonb_build_object('table','assessment_responses','id','73000000-0000-4000-8000-000000000103','natural','OPS-01','stable_refs',jsonb_build_object('question','OPS-01'),'row',jsonb_build_object('id','73000000-0000-4000-8000-000000000103','organisation_id',org_id,'session_id','73000000-0000-4000-8000-000000000001','question_id',q_ops,'answer','no','evidence_note','Privileged access review is scheduled but not yet completed.','updated_by',owner_id,'updated_at','2026-09-03T08:24:00Z','catalogue_version_id','00000000-0000-4000-8000-000000000001')),
    jsonb_build_object('table','soa_registers','id','73000000-0000-4000-8000-000000000201','natural','9001','row',jsonb_build_object('id','73000000-0000-4000-8000-000000000201','organisation_id',org_id,'assessment_session_id','73000000-0000-4000-8000-000000000001','version',9001,'title','CEO Demo Statement of Applicability','created_by',owner_id,'created_at','2026-09-03T08:35:00Z','updated_at','2026-09-03T08:45:00Z','control_catalogue_version_id','40000000-0000-4000-8000-000000000001')),
    jsonb_build_object('table','soa_items','id','73000000-0000-4000-8000-000000000211','natural','5.1','stable_refs',jsonb_build_object('control','5.1'),'row',jsonb_build_object('id','73000000-0000-4000-8000-000000000211','organisation_id',org_id,'soa_register_id','73000000-0000-4000-8000-000000000201','control_code','5.1','control_title','Direction for security policy','applicable',true,'status','operational','justification','Security policy direction is approved and reviewed.','evidence','Approved information security policy record.','position',0,'control_catalogue_version_id','40000000-0000-4000-8000-000000000001','control_id',cc_51,'owner_id',owner_id)),
    jsonb_build_object('table','soa_items','id','73000000-0000-4000-8000-000000000212','natural','5.2','stable_refs',jsonb_build_object('control','5.2'),'row',jsonb_build_object('id','73000000-0000-4000-8000-000000000212','organisation_id',org_id,'soa_register_id','73000000-0000-4000-8000-000000000201','control_code','5.2','control_title','Accountability for security roles','applicable',true,'status','in_progress','justification','Core responsibilities are assigned; deputy coverage remains open.','evidence','Current responsibility matrix.','position',1,'control_catalogue_version_id','40000000-0000-4000-8000-000000000001','control_id',cc_52,'owner_id',owner_id)),
    jsonb_build_object('table','soa_items','id','73000000-0000-4000-8000-000000000213','natural','5.18','stable_refs',jsonb_build_object('control','5.18'),'row',jsonb_build_object('id','73000000-0000-4000-8000-000000000213','organisation_id',org_id,'soa_register_id','73000000-0000-4000-8000-000000000201','control_code','5.18','control_title','Access rights','applicable',true,'status','pending','justification','Quarterly privileged access review is due.','evidence','','position',2,'control_catalogue_version_id','40000000-0000-4000-8000-000000000001','control_id',cc_518,'owner_id',owner_id)),
    jsonb_build_object('table','soa_items','id','73000000-0000-4000-8000-000000000214','natural','5.36','stable_refs',jsonb_build_object('control','5.36'),'row',jsonb_build_object('id','73000000-0000-4000-8000-000000000214','organisation_id',org_id,'soa_register_id','73000000-0000-4000-8000-000000000201','control_code','5.36','control_title','Compliance with policies and standards for information security','applicable',false,'status','not_applicable','justification','Excluded from this deliberately bounded fictional demonstration scope.','evidence','','position',3,'control_catalogue_version_id','40000000-0000-4000-8000-000000000001','control_id',cc_536,'owner_id',NULL)),
    jsonb_build_object('table','risks','id','73000000-0000-4000-8000-000000000301','natural','CEO-DEMO-RISK-01','stable_refs',jsonb_build_object('category','Access Control'),'row',jsonb_build_object('id','73000000-0000-4000-8000-000000000301','organisation_id',org_id,'reference','CEO-DEMO-RISK-01','title','Privileged access review overdue','description','The fictional quarterly review has not been completed for all privileged accounts.','owner_id',owner_id,'likelihood',4,'impact',5,'treatment','mitigate','treatment_plan','Complete the review, remove stale access, and retain approval evidence.','residual_likelihood',2,'residual_impact',3,'review_date','2026-09-12','status','treating','evidence','Assessment and SoA demo records.','source_assessment_session_id','73000000-0000-4000-8000-000000000001','source_soa_register_id','73000000-0000-4000-8000-000000000201','created_by',owner_id,'created_at','2026-09-03T09:00:00Z','updated_at','2026-09-03T09:00:00Z','category_id',category_access)),
    jsonb_build_object('table','risks','id','73000000-0000-4000-8000-000000000302','natural','CEO-DEMO-RISK-02','stable_refs',jsonb_build_object('category','Third-Party/Vendor Risk'),'row',jsonb_build_object('id','73000000-0000-4000-8000-000000000302','organisation_id',org_id,'reference','CEO-DEMO-RISK-02','title','Supplier continuity evidence incomplete','description','One fictional critical supplier has not supplied its latest continuity exercise record.','owner_id',owner_id,'likelihood',2,'impact',2,'treatment','transfer','treatment_plan','Obtain and review the supplier exercise report at the next service review.','residual_likelihood',1,'residual_impact',2,'review_date','2026-09-20','status','open','evidence','Supplier assurance tracker.','source_assessment_session_id','73000000-0000-4000-8000-000000000001','source_soa_register_id','73000000-0000-4000-8000-000000000201','created_by',owner_id,'created_at','2026-09-03T09:02:00Z','updated_at','2026-09-03T09:02:00Z','category_id',category_vendor)),
    jsonb_build_object('table','policies','id','73000000-0000-4000-8000-000000000401','natural','CEO-DEMO-POL-01','row',jsonb_build_object('id','73000000-0000-4000-8000-000000000401','organisation_id',org_id,'reference','CEO-DEMO-POL-01','title','Information Security Policy — Demo','body','Fictional policy for demonstrating ownership, approval, review and acceptance workflows.','version',2,'status','approved','owner_id',owner_id,'approved_by',owner_id,'approved_at','2026-09-03T09:10:00Z','review_due','2027-09-03','created_by',owner_id,'created_at','2026-09-03T09:05:00Z','updated_at','2026-09-03T09:10:00Z')),
    jsonb_build_object('table','policies','id','73000000-0000-4000-8000-000000000402','natural','CEO-DEMO-POL-02','row',jsonb_build_object('id','73000000-0000-4000-8000-000000000402','organisation_id',org_id,'reference','CEO-DEMO-POL-02','title','Supplier Security Standard — Demo','body','Fictional supplier security standard awaiting final leadership review.','version',1,'status','in_review','owner_id',owner_id,'approved_by',NULL,'approved_at',NULL,'review_due','2026-09-30','created_by',owner_id,'created_at','2026-09-03T09:06:00Z','updated_at','2026-09-03T09:06:00Z')),
    jsonb_build_object('table','policy_acceptances','id','73000000-0000-4000-8000-000000000411','natural','CEO-DEMO-POL-01:owner','row',jsonb_build_object('id','73000000-0000-4000-8000-000000000411','organisation_id',org_id,'policy_id','73000000-0000-4000-8000-000000000401','user_id',owner_id,'accepted_version',2,'accepted_at','2026-09-03T09:12:00Z','created_at','2026-09-03T09:12:00Z','trusted_at','2026-09-03T09:12:00Z')),
    jsonb_build_object('table','tasks','id','73000000-0000-4000-8000-000000000501','natural','Complete the privileged access review','stable_refs',jsonb_build_object('control','CH-002'),'row',jsonb_build_object('id','73000000-0000-4000-8000-000000000501','organisation_id',org_id,'title','Complete the privileged access review','detail','Review privileged accounts, remove stale access and retain owner approval.','status','in_progress','owner_id',owner_id,'due_on','2026-09-02','recurrence','quarterly','source','risk_treatment','control_id',legacy_2,'risk_id','73000000-0000-4000-8000-000000000301','policy_id',NULL,'created_by',owner_id,'created_at','2026-09-03T09:15:00Z','updated_at','2026-09-03T09:15:00Z','evidence_id',NULL)),
    jsonb_build_object('table','tasks','id','73000000-0000-4000-8000-000000000502','natural','Approve the supplier security standard','stable_refs',jsonb_build_object('control','CH-003'),'row',jsonb_build_object('id','73000000-0000-4000-8000-000000000502','organisation_id',org_id,'title','Approve the supplier security standard','detail','Complete final leadership review and publish version one.','status','open','owner_id',owner_id,'due_on','2026-09-08','recurrence',NULL,'source','policy_review','control_id',legacy_3,'risk_id',NULL,'policy_id','73000000-0000-4000-8000-000000000402','created_by',owner_id,'created_at','2026-09-03T09:16:00Z','updated_at','2026-09-03T09:16:00Z','evidence_id',NULL)),
    jsonb_build_object('table','tasks','id','73000000-0000-4000-8000-000000000503','natural','Close supplier audit corrective action','stable_refs',jsonb_build_object('control','CH-004'),'row',jsonb_build_object('id','73000000-0000-4000-8000-000000000503','organisation_id',org_id,'title','Close supplier audit corrective action','detail','Obtain continuity exercise evidence and verify the corrective action.','status','open','owner_id',owner_id,'due_on','2026-09-15','recurrence',NULL,'source','audit','control_id',legacy_4,'risk_id','73000000-0000-4000-8000-000000000302','policy_id',NULL,'created_by',owner_id,'created_at','2026-09-03T09:17:00Z','updated_at','2026-09-03T09:17:00Z','evidence_id',NULL)),
    jsonb_build_object('table','tasks','id','73000000-0000-4000-8000-000000000504','natural','Record leadership security objectives','stable_refs',jsonb_build_object('control','CH-001'),'row',jsonb_build_object('id','73000000-0000-4000-8000-000000000504','organisation_id',org_id,'title','Record leadership security objectives','detail','Document and approve the fictional annual security objectives.','status','done','owner_id',owner_id,'due_on','2026-09-03','recurrence','annually','source','gap','control_id',legacy_1,'risk_id',NULL,'policy_id','73000000-0000-4000-8000-000000000401','created_by',owner_id,'created_at','2026-09-03T09:18:00Z','updated_at','2026-09-03T09:20:00Z','evidence_id',NULL)),
    jsonb_build_object('table','audits','id','73000000-0000-4000-8000-000000000601','natural','CEO-DEMO-AUD-01','row',jsonb_build_object('id','73000000-0000-4000-8000-000000000601','organisation_id',org_id,'reference','CEO-DEMO-AUD-01','title','Q3 Internal ISMS Audit — Demo','scope','Fictional audit of governance, access control and supplier assurance.','status','reporting','lead_auditor_id',owner_id,'planned_start','2026-08-25','planned_end','2026-09-05','framework','ISO 27001:2022','created_by',owner_id,'created_at','2026-09-03T09:25:00Z','updated_at','2026-09-03T09:25:00Z')),
    jsonb_build_object('table','audit_findings','id','73000000-0000-4000-8000-000000000611','natural','Supplier continuity exercise evidence was not current','row',jsonb_build_object('id','73000000-0000-4000-8000-000000000611','organisation_id',org_id,'audit_id','73000000-0000-4000-8000-000000000601','checklist_item_id',NULL,'summary','Supplier continuity exercise evidence was not current','severity','major_nc','root_cause','The fictional evidence request was not included in the quarterly supplier review.','corrective_action','Add the request to the review checklist and verify the next response.','task_id','73000000-0000-4000-8000-000000000503','status','in_progress','created_by',owner_id,'created_at','2026-09-03T09:27:00Z','updated_at','2026-09-03T09:27:00Z')),
    jsonb_build_object('table','kpis','id','73000000-0000-4000-8000-000000000701','natural','Privileged access reviews completed on time','row',jsonb_build_object('id','73000000-0000-4000-8000-000000000701','organisation_id',org_id,'control_function','Access management','indicator','Privileged access reviews completed on time','measurement_type','manual','threshold','Target: 100%','observations','Current fictional performance is below target.','next_steps','Complete the overdue review and automate reminders.','responsible_id',owner_id,'last_reviewed','2026-09-03','task_id','73000000-0000-4000-8000-000000000501','created_by',owner_id,'created_at','2026-09-03T09:30:00Z','updated_at','2026-09-03T09:30:00Z')),
    jsonb_build_object('table','kpis','id','73000000-0000-4000-8000-000000000702','natural','Critical supplier evidence current','row',jsonb_build_object('id','73000000-0000-4000-8000-000000000702','organisation_id',org_id,'control_function','Supplier assurance','indicator','Critical supplier evidence current','measurement_type','manual','threshold','Target: at least 95%','observations','One fictional supplier record remains outstanding.','next_steps','Close the linked audit corrective action.','responsible_id',owner_id,'last_reviewed','2026-09-03','task_id','73000000-0000-4000-8000-000000000503','created_by',owner_id,'created_at','2026-09-03T09:31:00Z','updated_at','2026-09-03T09:31:00Z')),
    jsonb_build_object('table','kpi_measurements','id','73000000-0000-4000-8000-000000000711','natural','access:2026-08-01','row',jsonb_build_object('id','73000000-0000-4000-8000-000000000711','organisation_id',org_id,'kpi_id','73000000-0000-4000-8000-000000000701','value',100,'measured_on','2026-08-01','note','Previous fictional cycle completed on time.','created_by',owner_id,'created_at','2026-09-03T09:32:00Z')),
    jsonb_build_object('table','kpi_measurements','id','73000000-0000-4000-8000-000000000712','natural','access:2026-09-01','row',jsonb_build_object('id','73000000-0000-4000-8000-000000000712','organisation_id',org_id,'kpi_id','73000000-0000-4000-8000-000000000701','value',75,'measured_on','2026-09-01','note','Current fictional cycle has one overdue review.','created_by',owner_id,'created_at','2026-09-03T09:33:00Z')),
    jsonb_build_object('table','kpi_measurements','id','73000000-0000-4000-8000-000000000713','natural','supplier:2026-08-01','row',jsonb_build_object('id','73000000-0000-4000-8000-000000000713','organisation_id',org_id,'kpi_id','73000000-0000-4000-8000-000000000702','value',96,'measured_on','2026-08-01','note','Previous fictional supplier evidence coverage.','created_by',owner_id,'created_at','2026-09-03T09:34:00Z')),
    jsonb_build_object('table','kpi_measurements','id','73000000-0000-4000-8000-000000000714','natural','supplier:2026-09-01','row',jsonb_build_object('id','73000000-0000-4000-8000-000000000714','organisation_id',org_id,'kpi_id','73000000-0000-4000-8000-000000000702','value',88,'measured_on','2026-09-01','note','One fictional critical supplier record is outstanding.','created_by',owner_id,'created_at','2026-09-03T09:35:00Z')),
    jsonb_build_object('table','notifications','id','-73001','natural','task_due:task:73000000-0000-4000-8000-000000000501:2026-09-03','row',jsonb_build_object('id',-73001,'organisation_id',org_id,'user_id',owner_id,'kind','task_due','subject_type','task','subject_id','73000000-0000-4000-8000-000000000501','message','Demo: privileged access review is overdue and needs owner action.','sweep_on','2026-09-03','read_at',NULL,'created_at','2026-09-03T09:40:00Z')),
    jsonb_build_object('table','notifications','id','-73002','natural','audit_finding:audit_finding:73000000-0000-4000-8000-000000000611:2026-09-03','row',jsonb_build_object('id',-73002,'organisation_id',org_id,'user_id',owner_id,'kind','audit_finding','subject_type','audit_finding','subject_id','73000000-0000-4000-8000-000000000611','message','Demo: one major audit non-conformity is open.','sweep_on','2026-09-03','read_at',NULL,'created_at','2026-09-03T09:41:00Z')),
    jsonb_build_object('table','notifications','id','-73003','natural','policy_review:policy:73000000-0000-4000-8000-000000000402:2026-09-03','row',jsonb_build_object('id',-73003,'organisation_id',org_id,'user_id',owner_id,'kind','policy_review','subject_type','policy','subject_id','73000000-0000-4000-8000-000000000402','message','Demo: supplier security standard is awaiting approval.','sweep_on','2026-09-03','read_at','2026-09-03T10:00:00Z','created_at','2026-09-03T09:42:00Z')),
    jsonb_build_object('table','leadership_report_snapshots','id','73000000-0000-4000-8000-000000000801','natural','2026-09-03T10:15:00Z','row',jsonb_build_object('id','73000000-0000-4000-8000-000000000801','organisation_id',org_id,'organisation_name','ComplianceHub Local Demo','payload',jsonb_build_object('soaPercent',43,'soaTotal',3,'riskBands',jsonb_build_object('low',1,'moderate',0,'high',0,'very_high',1),'tasksOpen',3,'tasksOverdue',1,'evidence',jsonb_build_object('total',8,'expiring',0,'expired',0),'openAudits',1,'openNonConformities',1),'published_by',owner_id,'published_at','2026-09-03T10:15:00Z'))
  );

  IF jsonb_array_length(expectations) <> 30 OR (SELECT count(DISTINCT item->>'id') FROM jsonb_array_elements(expectations) item) <> 30 THEN
    RAISE EXCEPTION 'Fixture registry is not closed';
  END IF;

  FOREACH table_name IN ARRAY protected_tables LOOP
    EXECUTE format('SELECT count(*), encode(extensions.digest(coalesce(string_agg(to_jsonb(row_value)::text, E''\\n'' ORDER BY to_jsonb(row_value)::text), ''''), ''sha256''), ''hex'') FROM public.%I row_value', table_name)
      INTO row_count, state_hash;
    protected_before := protected_before || jsonb_build_object(table_name, jsonb_build_object('count', row_count, 'sha256', state_hash));
  END LOOP;
  FOREACH table_name IN ARRAY target_tables LOOP
    SELECT array_agg(item->>'id' ORDER BY item->>'id') INTO ids FROM jsonb_array_elements(expectations) item WHERE item->>'table' = table_name;
    EXECUTE format('SELECT count(*), encode(extensions.digest(coalesce(string_agg(to_jsonb(row_value)::text, E''\\n'' ORDER BY to_jsonb(row_value)::text), ''''), ''sha256''), ''hex'') FROM public.%I row_value WHERE row_value.organisation_id = $1 AND NOT (row_value.id::text = ANY($2))', table_name)
      INTO row_count, state_hash USING org_id, ids;
    existing_before := existing_before || jsonb_build_object(table_name, jsonb_build_object('count', row_count, 'sha256', state_hash));
    EXECUTE format('SELECT count(*) FROM public.%I row_value WHERE row_value.id::text = ANY($1)', table_name) INTO row_count USING ids;
    presence_count := presence_count + row_count;
  END LOOP;
  SELECT count(*), encode(extensions.digest(coalesce(string_agg(to_jsonb(row_value)::text, E'\n' ORDER BY to_jsonb(row_value)::text), ''), 'sha256'), 'hex')
    INTO row_count, state_hash FROM public.risk_categories row_value WHERE organisation_id = org_id;
  existing_before := existing_before || jsonb_build_object('risk_categories', jsonb_build_object('count', row_count, 'sha256', state_hash));
  SELECT coalesce(max(id),0), count(*), encode(extensions.digest(coalesce(string_agg(to_jsonb(row_value)::text, E'\n' ORDER BY id), ''), 'sha256'), 'hex')
    INTO audit_before_max, audit_before_count, audit_before_hash FROM public.audit_events row_value WHERE organisation_id = org_id;

  IF presence_count NOT IN (0,30) THEN RAISE EXCEPTION 'Fixture collision detected'; END IF;
${collisionInjection}
  IF EXISTS (SELECT 1 FROM public.assessment_sessions WHERE organisation_id=org_id AND title='CEO Demo ISO 27001 Gap Assessment' AND id<>'73000000-0000-4000-8000-000000000001')
    OR EXISTS (SELECT 1 FROM public.soa_registers WHERE organisation_id=org_id AND version=9001 AND id<>'73000000-0000-4000-8000-000000000201')
    OR EXISTS (SELECT 1 FROM public.risks WHERE organisation_id=org_id AND reference IN ('CEO-DEMO-RISK-01','CEO-DEMO-RISK-02') AND id::text <> ALL(ARRAY['73000000-0000-4000-8000-000000000301','73000000-0000-4000-8000-000000000302']))
    OR EXISTS (SELECT 1 FROM public.policies WHERE organisation_id=org_id AND reference IN ('CEO-DEMO-POL-01','CEO-DEMO-POL-02') AND id::text <> ALL(ARRAY['73000000-0000-4000-8000-000000000401','73000000-0000-4000-8000-000000000402']))
    OR EXISTS (SELECT 1 FROM public.audits WHERE organisation_id=org_id AND reference='CEO-DEMO-AUD-01' AND id<>'73000000-0000-4000-8000-000000000601')
    OR EXISTS (SELECT 1 FROM public.tasks WHERE organisation_id=org_id AND title IN ('Complete the privileged access review','Approve the supplier security standard','Close supplier audit corrective action','Record leadership security objectives') AND id::text <> ALL(ARRAY['73000000-0000-4000-8000-000000000501','73000000-0000-4000-8000-000000000502','73000000-0000-4000-8000-000000000503','73000000-0000-4000-8000-000000000504']))
    OR EXISTS (SELECT 1 FROM public.kpis WHERE organisation_id=org_id AND indicator IN ('Privileged access reviews completed on time','Critical supplier evidence current') AND id::text <> ALL(ARRAY['73000000-0000-4000-8000-000000000701','73000000-0000-4000-8000-000000000702']))
    OR EXISTS (SELECT 1 FROM public.notifications WHERE organisation_id=org_id AND id IN (-73001,-73002,-73003) AND user_id<>owner_id)
  THEN RAISE EXCEPTION 'Fixture collision detected'; END IF;

  FOREACH table_name IN ARRAY target_tables LOOP
    SELECT array_agg(item->>'id' ORDER BY item->>'id') INTO ids FROM jsonb_array_elements(expectations) item WHERE item->>'table' = table_name;
    EXECUTE format('SELECT jsonb_build_object(''count'',count(*),''sha256'',encode(extensions.digest(coalesce(string_agg(to_jsonb(populated)::text,E''\\n'' ORDER BY to_jsonb(populated)::text),''''),''sha256''),''hex'')) FROM jsonb_array_elements($1) item CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%I,item->''row'') populated WHERE item->>''table''=$2', table_name)
      INTO state USING expectations, table_name;
    expected_bundle := expected_bundle || jsonb_build_object(table_name,state);
    EXECUTE format('SELECT jsonb_build_object(''count'',count(*),''sha256'',encode(extensions.digest(coalesce(string_agg(to_jsonb(row_value)::text,E''\\n'' ORDER BY to_jsonb(row_value)::text),''''),''sha256''),''hex'')) FROM public.%I row_value WHERE row_value.id::text=ANY($1)', table_name)
      INTO state USING ids;
    actual_bundle := actual_bundle || jsonb_build_object(table_name,state);
  END LOOP;
  IF presence_count = 30 AND actual_bundle IS DISTINCT FROM expected_bundle THEN RAISE EXCEPTION 'Fixture collision detected'; END IF;

${mutation}

  actual_bundle := '{}'::jsonb;
  FOREACH table_name IN ARRAY target_tables LOOP
    SELECT array_agg(item->>'id' ORDER BY item->>'id') INTO ids FROM jsonb_array_elements(expectations) item WHERE item->>'table' = table_name;
    EXECUTE format('SELECT jsonb_build_object(''count'',count(*),''sha256'',encode(extensions.digest(coalesce(string_agg(to_jsonb(row_value)::text,E''\\n'' ORDER BY to_jsonb(row_value)::text),''''),''sha256''),''hex'')) FROM public.%I row_value WHERE row_value.id::text=ANY($1)', table_name)
      INTO state USING ids;
    actual_bundle := actual_bundle || jsonb_build_object(table_name,state);
  END LOOP;
  IF actual_bundle IS DISTINCT FROM expected_bundle THEN RAISE EXCEPTION 'Fixture verification failed'; END IF;

  FOREACH table_name IN ARRAY target_tables LOOP
    SELECT array_agg(item->>'id' ORDER BY item->>'id') INTO ids FROM jsonb_array_elements(expectations) item WHERE item->>'table' = table_name;
    EXECUTE format('SELECT count(*), encode(extensions.digest(coalesce(string_agg(to_jsonb(row_value)::text, E''\\n'' ORDER BY to_jsonb(row_value)::text), ''''), ''sha256''), ''hex'') FROM public.%I row_value WHERE row_value.organisation_id = $1 AND NOT (row_value.id::text = ANY($2))', table_name)
      INTO row_count, state_hash USING org_id, ids;
    existing_after := existing_after || jsonb_build_object(table_name, jsonb_build_object('count', row_count, 'sha256', state_hash));
  END LOOP;
  SELECT count(*), encode(extensions.digest(coalesce(string_agg(to_jsonb(row_value)::text, E'\n' ORDER BY to_jsonb(row_value)::text), ''), 'sha256'), 'hex')
    INTO row_count, state_hash FROM public.risk_categories row_value WHERE organisation_id = org_id;
  existing_after := existing_after || jsonb_build_object('risk_categories', jsonb_build_object('count', row_count, 'sha256', state_hash));
  IF existing_after IS DISTINCT FROM existing_before THEN RAISE EXCEPTION 'Persistent state changed outside the fixture registry'; END IF;

  FOREACH table_name IN ARRAY protected_tables LOOP
    EXECUTE format('SELECT count(*), encode(extensions.digest(coalesce(string_agg(to_jsonb(row_value)::text, E''\\n'' ORDER BY to_jsonb(row_value)::text), ''''), ''sha256''), ''hex'') FROM public.%I row_value', table_name)
      INTO row_count, state_hash;
    protected_after := protected_after || jsonb_build_object(table_name, jsonb_build_object('count', row_count, 'sha256', state_hash));
  END LOOP;
  IF protected_after IS DISTINCT FROM protected_before THEN RAISE EXCEPTION 'Protected integration state changed'; END IF;

  SELECT count(*) INTO audit_added FROM public.audit_events WHERE organisation_id=org_id AND id>audit_before_max;
  IF audit_added <> (CASE WHEN created_fixture THEN 30 ELSE 0 END) THEN RAISE EXCEPTION 'Unexpected audit event delta'; END IF;
  IF created_fixture AND EXISTS (
    SELECT 1 FROM public.audit_events event
    WHERE event.organisation_id=org_id AND event.id>audit_before_max
      AND (event.action<>'insert' OR event.entity_type LIKE 'github_%' OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(expectations) item
        WHERE item->>'table'=event.entity_type AND item->>'id'=event.entity_id
      ))
  ) THEN RAISE EXCEPTION 'Unexpected audit event delta'; END IF;
  IF (SELECT count(*) FROM public.audit_events WHERE organisation_id=org_id AND id<=audit_before_max) <> audit_before_count
    OR (SELECT encode(extensions.digest(coalesce(string_agg(to_jsonb(row_value)::text,E'\n' ORDER BY id),''),'sha256'),'hex') FROM public.audit_events row_value WHERE organisation_id=org_id AND id<=audit_before_max) <> audit_before_hash
  THEN RAISE EXCEPTION 'Existing audit history changed'; END IF;

  semantic_manifest := (SELECT jsonb_agg(jsonb_build_object(
    'table',item->>'table','id',item->>'id','natural',item->>'natural','stable_refs',coalesce(item->'stable_refs','{}'::jsonb),
    'row',(item->'row') - ARRAY['question_id','control_id','category_id','created_by','updated_by','owner_id','approved_by','published_by','responsible_id','user_id','lead_auditor_id']
  ) ORDER BY item->>'table',item->>'id') FROM jsonb_array_elements(expectations) item);
  fixture_digest := encode(extensions.digest(semantic_manifest::text,'sha256'),'hex');
  protected_digest := encode(extensions.digest(protected_after::text,'sha256'),'hex');
  existing_digest := encode(extensions.digest(existing_after::text,'sha256'),'hex');
  PERFORM set_config('compliancehub.fixture_summary', jsonb_build_object(
    'ok',true,'mode',CASE WHEN '${mode}'='verify' THEN 'verified' WHEN created_fixture THEN 'created' ELSE 'unchanged' END,
    'fixtureVersion','ceo-demo-v1','fixtureRecords',30,'auditEventsAdded',audit_added,
    'counts',jsonb_build_object('assessmentSessions',1,'assessmentResponses',3,'soaRegisters',1,'soaItems',4,'risks',2,'tasks',4,'policies',2,'policyAcceptances',1,'audits',1,'auditFindings',1,'kpis',2,'kpiMeasurements',4,'notifications',3,'leadershipReports',1),
    'fixtureSha256',fixture_digest,'protectedSha256',protected_digest,'existingRowsSha256',existing_digest
  )::text,true);
END
$fixture$;
SELECT current_setting('compliancehub.fixture_summary');
COMMIT;
`;
}

export const fixtureApplySql = fixtureSql("apply");
export const fixtureVerifySql = fixtureSql("verify");

function fileSha256(path: string): string {
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    throw failure();
  }
}

export function runLocalCeoDemoFixture(
  mode: FixtureMode,
  options: { injectCollisionForTest?: boolean } = {},
): FixtureSummary {
  try {
    const endpoint = execFileSync(localDockerExecutable, localDockerContextInspectArgs(), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const identity = execFileSync(localDockerExecutable, ["--context", localDockerContext, ...localCeoContainerInspectArgs()], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assertApprovedLocalCeoContainerIdentity(endpoint, identity);

    const artifact = join(process.cwd(), phase2ArtifactPath);
    const artifactBefore = fileSha256(artifact);
    if (artifactBefore !== historicalEvidenceSha256) throw failure();

    const sql = fixtureSql(mode, options.injectCollisionForTest === true);
    const output = execFileSync(localDockerExecutable, [
      "--context", localDockerContext, "exec", "-i", "--user", "postgres", localContainer,
      "psql", "--dbname", "postgres", "--no-psqlrc", "--quiet", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1",
    ], { encoding: "utf8", input: sql, stdio: ["pipe", "pipe", "pipe"] });

    if (fileSha256(artifact) !== artifactBefore) throw failure();
    const lines = output.replace(/\r/g, "").split("\n").filter((line) => line.length > 0);
    if (lines.length !== 1) throw failure();
    const databaseSummary = databaseSummarySchema.parse(JSON.parse(lines[0]));
    return summarySchema.parse({ ...databaseSummary, artifactSha256: artifactBefore });
  } catch {
    throw failure();
  }
}

function runFromCommandLine(): void {
  const summary = runLocalCeoDemoFixture(parseFixtureMode(process.argv.slice(2)));
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runFromCommandLine();
