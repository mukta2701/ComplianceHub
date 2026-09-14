import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { one } from "@/lib/supabase/one";
import { deriveEvidenceStatus, summariseEvidenceFreshness, type EvidenceKind, type EvidenceStatus } from "@/features/evidence/domain/evidence";
import type { TaskStatus } from "@/features/tasks/domain/tasks";
import { SOA_STATUS_LABEL, type SoaStatus } from "../domain/soa";
import { classifyRequirementEvidence, collectSoaFinalisationBlockers, countSoaFinalisationBlockers, SOA_CATALOGUE_SIZE, type SoaFinalisationBlockers } from "./finalisation";
import { deriveSoaReviewState, type SoaDomain, type SoaQueueItem } from "./review-queue";

export type ControlSourceAnswer = {
  questionId: string; code: string; prompt: string;
  answer: "yes" | "partially" | "no" | "not_applicable" | null;
  evidenceNote: string; updatedAt: string | null;
};
export type ReviewListMetadata = { total: number | null; shown: number; limit: number; truncated: boolean };
export type ControlReviewItem = SoaQueueItem & {
  decisionRevision: number;
  sourceAnswers: ControlSourceAnswer[];
  linkedTasks: Array<{ id: string; reference: string; title: string; status: TaskStatus; dueOn: string | null }>;
  evidence: Array<{ id: string; title: string; storedStatus: EvidenceStatus; validUntil: string | null }>;
  linkedEvidence: Array<{ id: string; title: string; status: EvidenceStatus; storedStatus: EvidenceStatus; validUntil: string | null; kind: EvidenceKind }>;
  recentAuditEvents: Array<{ action: string; occurredAt: string }>;
  lists: { tasks: ReviewListMetadata; evidence: ReviewListMetadata; history: ReviewListMetadata };
};
const snapshotItemSchema = z.object({
  controlCode: z.string().min(1), controlTitle: z.string(), applicable: z.boolean(),
  status: z.string().min(1), justification: z.string(), evidence: z.string(),
  // Older immutable snapshots predate recorded owner IDs.
  ownerId: z.string().nullable().optional(),
});
const snapshotSchema = z.object({
  id: z.string().min(1), organisation_id: z.string().min(1), soa_register_id: z.string().min(1),
  title: z.string().min(1), version: z.number().int().positive(), organisation_name: z.string(),
  finalised_at: z.string().min(1), finalised_by: z.string().min(1), assessment_session_id: z.string().min(1),
  catalogue_version_id: z.string().min(1), control_catalogue_version_id: z.string().min(1),
  items: z.array(snapshotItemSchema).min(1),
});
export type FinalisedControlStatement = {
  id: string; organisationName: string; finalisedAt: string; finalisedBy: string;
  items: z.infer<typeof snapshotItemSchema>[];
};
export type CatalogueProvenance = { id: string; title: string | null; version: string | null };
export type ControlReviewLoadResult = {
  register: null | {
    id: string; title: string; version: number; updatedAt: string;
    sourceAssessment: { id: string; title: string | null; state: string | null; revision: number | null; catalogueVersionId: string };
    controlCatalogueVersionId: string;
    finalisedSnapshotId: string | null;
  };
  finalisedStatement: FinalisedControlStatement | null;
  catalogues: { assessment: CatalogueProvenance; control: CatalogueProvenance } | null;
  items: ControlReviewItem[];
  members: Array<{ id: string; name: string }>;
  relatedRisks: Array<{ id: string; reference: string; title: string; status: string; relationship: "assessment" | "register" }>;
  riskLists: { assessment: ReviewListMetadata; register: ReviewListMetadata };
  finalisation: { readiness: "ready" | "blocked" | "could_not_verify" | "finalised"; blockers: SoaFinalisationBlockers; unavailableInputs: string[] };
  optionalUnavailable: string[];
  aiEnabled: boolean;
};

type RegisterRow = { id: string; title: string; version: number; updated_at: string; assessment_session_id: string; control_catalogue_version_id: string };
type AssessmentRow = { id: string; title: string; state: string; revision: number; catalogue_version_id: string };
type ItemRow = { id: string; control_catalogue_version_id: string; control_id: string; control_code: string; control_title: string; applicable: boolean; status: SoaStatus; justification: string; evidence: string; owner_id: string | null; position: number; decision_revision: number };
type QuestionRow = { id: string; catalogue_version_id: string; code: string; prompt: string; position: number };
type ResponseRow = { question_id: string; answer: ControlSourceAnswer["answer"]; evidence_note: string; updated_at: string };
type MemberRow = { user_id: string; profiles: { display_name: string | null } | { display_name: string | null }[] | null };
type EvidenceRow = { id: string; organisation_id: string; title: string; status: EvidenceStatus; valid_until: string | null; kind: EvidenceKind };
type EvidenceLinkRow = { control_id: string; evidence_id: string; evidence: EvidenceRow | EvidenceRow[] | null };
type RiskRow = { id: string; reference: string; title: string; status: string };
const COMPLETE_LIMIT = 5000;
const DISPLAY_LIMIT = 20;
const HISTORY_LIMIT = 5;
const RISK_LIMIT = 50;
const domains = new Set(["organisational", "people", "physical", "technological"]);
function metadata(total: number | null, shown: number, limit: number): ReviewListMetadata {
  return { total, shown, limit, truncated: total !== null && total > shown };
}
class UnavailableInput extends Error {
  constructor(readonly input: string) { super(`Could not verify ${input}`); }
}
async function readRows<T>(input: string, query: PromiseLike<{ data: T[] | null; error: unknown; count: number | null }>, limited = false) {
  try {
    const result = await query;
    if (result.error || !result.data || result.count === null || (!limited && result.count !== result.data.length)) throw new UnavailableInput(input);
    return { rows: result.data, total: result.count };
  } catch { throw new UnavailableInput(input); }
}
function first<T>(rows: T[], input: string): T {
  if (rows.length !== 1) throw new UnavailableInput(input);
  return rows[0];
}

const catalogueProvenanceSchema = z.object({ id: z.string().min(1), title: z.string().min(1), version: z.string().min(1) });
async function readCatalogueProvenance(supabase: SupabaseClient, table: "catalogue_versions" | "control_catalogue_versions", id: string, label: string): Promise<CatalogueProvenance> {
  if (!id) throw new UnavailableInput(label);
  const result = await readRows(label, supabase.from(table).select("id,title,version", { count: "exact" }).eq("id", id).limit(1).returns<unknown[]>());
  const parsed = catalogueProvenanceSchema.safeParse(first(result.rows, label));
  if (!parsed.success || parsed.data.id !== id) throw new UnavailableInput(label);
  return parsed.data;
}

const historyGroupSchema = z.object({
  item_id: z.string().min(1), total: z.number().int().nonnegative().safe(),
  entries: z.array(z.object({ id: z.string().min(1), action: z.string().min(1), occurred_at: z.string().refine((value) => Number.isFinite(Date.parse(value))) })).max(HISTORY_LIMIT),
}).refine((group) => group.entries.length === Math.min(group.total, HISTORY_LIMIT)
  && new Set(group.entries.map((entry) => entry.id)).size === group.entries.length
  && group.entries.every((entry, index) => {
    if (index === 0) return true;
    const previous = group.entries[index - 1];
    if (Date.parse(previous.occurred_at) < Date.parse(entry.occurred_at)) return false;
    // Compare identities only for identical timestamp strings; Date loses SQL microseconds.
    if (previous.occurred_at !== entry.occurred_at) return true;
    return /^\d+$/.test(previous.id) && /^\d+$/.test(entry.id)
      ? BigInt(previous.id) > BigInt(entry.id)
      : previous.id.localeCompare(entry.id) > 0;
  }));
const taskGroupSchema = z.object({
  item_id: z.string().min(1), total: z.number().int().nonnegative().safe(), open_count: z.number().int().nonnegative().safe(),
  entries: z.array(z.object({ id: z.string().min(1), title: z.string().min(1), status: z.enum(["open", "in_progress", "done", "cancelled"]), due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() })).max(DISPLAY_LIMIT),
}).refine((group) => {
  const shownOpen = group.entries.filter((entry) => entry.status === "open" || entry.status === "in_progress").length;
  return group.entries.length === Math.min(group.total, DISPLAY_LIMIT) && group.open_count <= group.total
    && shownOpen <= group.open_count && group.entries.length - shownOpen <= group.total - group.open_count
    && new Set(group.entries.map((entry) => entry.id)).size === group.entries.length
    && group.entries.every((entry, index) => index === 0 || group.entries[index - 1].id.localeCompare(entry.id) < 0);
});

// Missing/invalid known groups affect only their decision. Unknown identities make
// the dataset untrustworthy, while the independently loaded dataset stays usable.
async function readContextGroups<T extends { item_id: string }>(query: () => PromiseLike<{ data: unknown; error: unknown }>, itemIds: ReadonlySet<string>, schema: z.ZodType<T>): Promise<Map<string, T>> {
  try {
    const result = await query();
    if (result.error || !Array.isArray(result.data)) return new Map();
    const groups = new Map<string, T>();
    const seen = new Set<string>();
    for (const row of result.data) {
      if (!row || typeof row.item_id !== "string" || !itemIds.has(row.item_id)) return new Map();
      if (seen.has(row.item_id)) { groups.delete(row.item_id); continue; }
      seen.add(row.item_id);
      const parsed = schema.safeParse(row);
      if (parsed.success) groups.set(row.item_id, parsed.data);
    }
    return groups;
  } catch { return new Map(); }
}

type ReviewContext = { organisationId: string; registerId: string; today?: string };
/** Reads current context; it does not preserve answers seen at decision-save time. */
export async function loadControlReview(supabase: SupabaseClient, context: ReviewContext): Promise<ControlReviewLoadResult> {
  try { return await readControlReview(supabase, context); }
  catch (error) {
    return {
      register: null, finalisedStatement: null, catalogues: null, items: [], members: [], relatedRisks: [], aiEnabled: false,
      riskLists: { assessment: metadata(null, 0, RISK_LIMIT), register: metadata(null, 0, RISK_LIMIT) },
      finalisation: { readiness: "could_not_verify", blockers: collectSoaFinalisationBlockers([], new Set()), unavailableInputs: [error instanceof UnavailableInput ? error.input : "review data"] },
      optionalUnavailable: [],
    };
  }
}
async function readControlReview(supabase: SupabaseClient, context: ReviewContext): Promise<ControlReviewLoadResult> {
  const { organisationId, registerId } = context;
  const today = context.today ?? new Date().toISOString().slice(0, 10);
  const register = first((await readRows("register", supabase.from("soa_registers")
    .select("id,title,version,updated_at,assessment_session_id,control_catalogue_version_id", { count: "exact" })
    .eq("organisation_id", organisationId).eq("id", registerId).limit(1).returns<RegisterRow[]>())).rows, "register");
  const snapshotResult = await readRows("final statement", supabase.from("soa_snapshots")
    .select("id,organisation_id,soa_register_id,title,version,organisation_name,finalised_at,finalised_by,assessment_session_id,catalogue_version_id,control_catalogue_version_id,items", { count: "exact" })
    .eq("organisation_id", organisationId).eq("soa_register_id", registerId).limit(1).returns<unknown[]>());
  if (snapshotResult.rows.length) {
    const parsed = snapshotSchema.safeParse(snapshotResult.rows[0]);
    if (!parsed.success || parsed.data.organisation_id !== organisationId || parsed.data.soa_register_id !== registerId) throw new UnavailableInput("final statement");
    const snapshot = parsed.data;
    // Version labels are immutable catalogue metadata, but their availability must not hide saved identities.
    const [assessmentCatalogue, controlCatalogue] = await Promise.allSettled([
      readCatalogueProvenance(supabase, "catalogue_versions", snapshot.catalogue_version_id, "Assessment catalogue label"),
      readCatalogueProvenance(supabase, "control_catalogue_versions", snapshot.control_catalogue_version_id, "Control catalogue label"),
    ]);
    return {
      register: {
        id: snapshot.soa_register_id, title: snapshot.title, version: snapshot.version, updatedAt: snapshot.finalised_at,
        sourceAssessment: { id: snapshot.assessment_session_id, title: null, state: null, revision: null, catalogueVersionId: snapshot.catalogue_version_id },
        controlCatalogueVersionId: snapshot.control_catalogue_version_id, finalisedSnapshotId: snapshot.id,
      },
      finalisedStatement: { id: snapshot.id, organisationName: snapshot.organisation_name, finalisedAt: snapshot.finalised_at, finalisedBy: snapshot.finalised_by, items: snapshot.items },
      catalogues: {
        assessment: assessmentCatalogue.status === "fulfilled" ? assessmentCatalogue.value : { id: snapshot.catalogue_version_id, title: null, version: null },
        control: controlCatalogue.status === "fulfilled" ? controlCatalogue.value : { id: snapshot.control_catalogue_version_id, title: null, version: null },
      },
      items: [], members: [], relatedRisks: [], aiEnabled: false,
      riskLists: { assessment: metadata(null, 0, RISK_LIMIT), register: metadata(null, 0, RISK_LIMIT) },
      finalisation: {
        readiness: "finalised", unavailableInputs: [],
        blockers: { incompleteCatalogue: false, pending: [], missingRationale: [], unassigned: [], missingEvidence: [], expiredEvidence: [] },
      },
      optionalUnavailable: [
        ...(assessmentCatalogue.status === "rejected" ? ["Assessment catalogue label"] : []),
        ...(controlCatalogue.status === "rejected" ? ["Control catalogue label"] : []),
      ],
    };
  }
  const [assessmentResult, itemResult, memberResult, catalogueResult] = await Promise.all([
    readRows("source assessment", supabase.from("assessment_sessions").select("id,title,state,revision,catalogue_version_id", { count: "exact" }).eq("organisation_id", organisationId).eq("id", register.assessment_session_id).limit(1).returns<AssessmentRow[]>()),
    readRows("decisions", supabase.from("soa_items").select("id,control_catalogue_version_id,control_id,control_code,control_title,applicable,status,justification,evidence,owner_id,position,decision_revision", { count: "exact" }).eq("organisation_id", organisationId).eq("soa_register_id", registerId).order("position").limit(COMPLETE_LIMIT).returns<ItemRow[]>()),
    readRows("membership", supabase.from("memberships").select("user_id,profiles(display_name)", { count: "exact" }).eq("organisation_id", organisationId).order("user_id").limit(COMPLETE_LIMIT).returns<MemberRow[]>()),
    readRows("control catalogue", supabase.from("control_catalogue_controls").select("id,catalogue_version_id,theme", { count: "exact" }).eq("catalogue_version_id", register.control_catalogue_version_id).order("position").limit(COMPLETE_LIMIT).returns<Array<{ id: string; catalogue_version_id: string; theme: SoaDomain }>>()),
  ]);
  const assessment = first(assessmentResult.rows, "source assessment");
  if (catalogueResult.rows.length !== SOA_CATALOGUE_SIZE
    || new Set(catalogueResult.rows.map((control) => control.id)).size !== SOA_CATALOGUE_SIZE
    || catalogueResult.rows.some((control) => !control.id || control.catalogue_version_id !== register.control_catalogue_version_id || !domains.has(control.theme))) {
    throw new UnavailableInput("control catalogue");
  }
  const [assessmentCatalogue, controlCatalogue] = await Promise.all([
    readCatalogueProvenance(supabase, "catalogue_versions", assessment.catalogue_version_id, "assessment catalogue identity"),
    readCatalogueProvenance(supabase, "control_catalogue_versions", register.control_catalogue_version_id, "control catalogue identity"),
  ]);
  const [questionResult, responseResult, sourceMappingResult, workMappingResult] = await Promise.all([
    readRows("assessment catalogue", supabase.from("catalogue_questions").select("id,catalogue_version_id,code,prompt,position", { count: "exact" }).eq("catalogue_version_id", assessment.catalogue_version_id).order("position").limit(COMPLETE_LIMIT).returns<QuestionRow[]>()),
    readRows("assessment answers", supabase.from("assessment_responses").select("question_id,answer,evidence_note,updated_at", { count: "exact" }).eq("organisation_id", organisationId).eq("session_id", assessment.id).order("question_id").limit(COMPLETE_LIMIT).returns<ResponseRow[]>()),
    readRows("assessment mappings", supabase.from("assessment_control_mappings").select("catalogue_question_id,control_id", { count: "exact" }).in("control_id", itemResult.rows.map((item) => item.control_id)).order("catalogue_question_id").order("control_id").limit(COMPLETE_LIMIT).returns<Array<{ catalogue_question_id: string; control_id: string }>>()),
    readRows("evidence mappings", supabase.from("requirement_control_mappings").select("requirement_id,control_id", { count: "exact" }).in("requirement_id", itemResult.rows.map((item) => item.control_id)).order("requirement_id").order("control_id").limit(COMPLETE_LIMIT).returns<Array<{ requirement_id: string; control_id: string }>>()),
  ]);
  if (!questionResult.rows.length || questionResult.rows.some((question) => !question.id || question.catalogue_version_id !== assessment.catalogue_version_id)) throw new UnavailableInput("assessment catalogue");
  if (!memberResult.rows.length) throw new UnavailableInput("membership");
  const members = memberResult.rows.map((member) => ({ id: member.user_id, name: one(member.profiles)?.display_name?.trim() || "Workspace member" }));
  const memberNames = new Map(members.map((member) => [member.id, member.name]));
  const catalogue = new Map(catalogueResult.rows.map((control) => [control.id, control.theme]));
  const responses = new Map(responseResult.rows.map((response) => [response.question_id, response]));
  const items: ControlReviewItem[] = itemResult.rows.map((item) => {
    const domain = catalogue.get(item.control_id);
    if (!domain || !domains.has(domain) || item.control_catalogue_version_id !== register.control_catalogue_version_id) throw new UnavailableInput("control catalogue");
    if (!(item.status in SOA_STATUS_LABEL)) throw new UnavailableInput("decisions");
    const mappedIds = new Set(sourceMappingResult.rows.filter((mapping) => mapping.control_id === item.control_id).map((mapping) => mapping.catalogue_question_id));
    const sourceAnswers = questionResult.rows.filter((question) => mappedIds.has(question.id)).map((question) => {
      const response = responses.get(question.id);
      return { questionId: question.id, code: question.code, prompt: question.prompt, answer: response?.answer ?? null, evidenceNote: response?.evidence_note ?? "", updatedAt: response?.updated_at ?? null };
    });
    const projected = {
      id: item.id, controlId: item.control_id, code: item.control_code, title: item.control_title,
      domain, applicable: item.applicable, status: item.status, justification: item.justification,
      evidenceText: item.evidence,
      ownerId: item.owner_id && memberNames.has(item.owner_id) ? item.owner_id : null,
      ownerName: item.owner_id ? memberNames.get(item.owner_id) ?? "Former workspace member" : null,
      evidenceTotal: 0, evidenceExpiring: 0, evidenceExpired: 0, openTaskCount: 0, position: item.position,
    };
    return {
      ...projected, reviewState: deriveSoaReviewState(projected), decisionRevision: Number(item.decision_revision),
      sourceAnswers, evidence: [], linkedEvidence: [], linkedTasks: [], recentAuditEvents: [],
      lists: { tasks: metadata(0, 0, DISPLAY_LIMIT), evidence: metadata(0, 0, DISPLAY_LIMIT), history: metadata(0, 0, HISTORY_LIMIT) },
    };
  });
  const sharedIds = [...new Set(workMappingResult.rows.map((mapping) => mapping.control_id))];
  const evidenceLinks = sharedIds.length ? (await readRows("evidence", supabase.from("evidence_links")
    .select("control_id,evidence_id,evidence(id,organisation_id,title,status,valid_until,kind)", { count: "exact" })
    .eq("organisation_id", organisationId).in("control_id", sharedIds).order("evidence_id").order("control_id").limit(COMPLETE_LIMIT).returns<EvidenceLinkRow[]>())).rows : [];
  const { live: liveRequirements, expired: expiredRequirements } = classifyRequirementEvidence(
    workMappingResult.rows.map((mapping) => ({ requirementId: mapping.requirement_id, controlId: mapping.control_id })),
    evidenceLinks.map((link) => ({ controlId: link.control_id, evidenceStatus: one(link.evidence)?.status ?? null })),
  );
  const optionalUnavailable = new Set<string>();
  const relatedRisks: ControlReviewLoadResult["relatedRisks"] = [];
  const riskLists = { assessment: metadata(0, 0, RISK_LIMIT), register: metadata(0, 0, RISK_LIMIT) };
  for (const relationship of ["assessment", "register"] as const) {
    try {
      const risks = await readRows("related risks", supabase.from("risks").select("id,reference,title,status", { count: "exact" })
        .eq("organisation_id", organisationId).eq(relationship === "assessment" ? "source_assessment_session_id" : "source_soa_register_id", relationship === "assessment" ? assessment.id : registerId)
        .order("reference").order("id").limit(RISK_LIMIT).returns<RiskRow[]>(), true);
      relatedRisks.push(...risks.rows.map((risk) => ({ id: risk.id, reference: risk.reference, title: risk.title, status: risk.status, relationship })));
      riskLists[relationship] = metadata(risks.total, risks.rows.length, RISK_LIMIT);
    } catch {
      optionalUnavailable.add(`${relationship === "assessment" ? "Assessment" : "Register"} related risks`);
      riskLists[relationship] = metadata(null, 0, RISK_LIMIT);
    }
  }
  for (const item of items) {
    const controlIds = workMappingResult.rows.filter((mapping) => mapping.requirement_id === item.controlId).map((mapping) => mapping.control_id);
    const records = new Map<string, EvidenceRow>();
    for (const link of evidenceLinks.filter((link) => controlIds.includes(link.control_id))) {
      const evidence = one(link.evidence);
      if (!evidence || evidence.organisation_id !== organisationId) throw new UnavailableInput("evidence");
      records.set(evidence.id, evidence);
    }
    const allEvidence = [...records.values()].map((evidence) => {
      return { id: evidence.id, title: evidence.title, storedStatus: evidence.status, status: evidence.status === "current" || evidence.status === "expiring" ? deriveEvidenceStatus(evidence.valid_until, today) : evidence.status, validUntil: evidence.valid_until, kind: evidence.kind };
    });
    const freshness = summariseEvidenceFreshness(allEvidence);
    Object.assign(item, { evidenceTotal: freshness.total, evidenceExpiring: freshness.expiring, evidenceExpired: freshness.expired });
    item.linkedEvidence = allEvidence.slice(0, DISPLAY_LIMIT);
    item.evidence = item.linkedEvidence.map(({ id, title, storedStatus, validUntil }) => ({ id, title, storedStatus, validUntil }));
    item.lists.evidence = metadata(allEvidence.length, item.linkedEvidence.length, DISPLAY_LIMIT);
    item.reviewState = deriveSoaReviewState(item);
  }
  const itemIds = new Set(items.map((item) => item.id));
  const args = { target_organisation_id: organisationId, target_register_id: registerId };
  const [historyGroups, taskGroups] = await Promise.all([
    readContextGroups(() => supabase.rpc("load_control_review_history", args), itemIds, historyGroupSchema),
    readContextGroups(() => supabase.rpc("load_control_review_tasks", args), itemIds, taskGroupSchema),
  ]);
  for (const item of items) {
    const history = historyGroups.get(item.id);
    if (history) {
      item.recentAuditEvents = history.entries.map((event) => ({ action: event.action, occurredAt: event.occurred_at }));
      item.lists.history = metadata(history.total, history.entries.length, HISTORY_LIMIT);
    } else {
      optionalUnavailable.add("Audit history");
      item.lists.history = metadata(null, 0, HISTORY_LIMIT);
    }
    const hasMappings = workMappingResult.rows.some((mapping) => mapping.requirement_id === item.controlId);
    const tasks = taskGroups.get(item.id);
    if (tasks && (hasMappings || tasks.total === 0)) {
      item.openTaskCount = tasks.open_count;
      item.linkedTasks = tasks.entries.map((task) => ({ id: task.id, reference: task.id, title: task.title, status: task.status, dueOn: task.due_on }));
      item.lists.tasks = metadata(tasks.total, tasks.entries.length, DISPLAY_LIMIT);
    } else if (hasMappings || tasks) {
      optionalUnavailable.add("Linked tasks");
      item.lists.tasks = metadata(null, 0, DISPLAY_LIMIT);
    }
    // Verified lack of mappings means known zero tasks even if the optional read failed.
  }
  let aiEnabled = false;
  try {
    const settings = await readRows("AI settings", supabase.from("ai_workspace_settings").select("enabled", { count: "exact" }).eq("organisation_id", organisationId).limit(1).returns<Array<{ enabled: boolean }>>());
    aiEnabled = settings.rows[0]?.enabled === true;
  } catch { optionalUnavailable.add("AI settings"); }
  const blockers = collectSoaFinalisationBlockers(items, liveRequirements, expiredRequirements);
  return {
    register: {
      id: register.id, title: register.title, version: register.version, updatedAt: register.updated_at,
      sourceAssessment: {
        id: assessment.id, title: assessment.title, state: assessment.state,
        revision: Number(assessment.revision), catalogueVersionId: assessment.catalogue_version_id,
      },
      controlCatalogueVersionId: register.control_catalogue_version_id, finalisedSnapshotId: null,
    },
    finalisedStatement: null,
    catalogues: {
      assessment: assessmentCatalogue,
      control: controlCatalogue,
    },
    items, members, relatedRisks, riskLists,
    finalisation: { readiness: countSoaFinalisationBlockers(blockers) ? "blocked" : "ready", blockers, unavailableInputs: [] },
    optionalUnavailable: [...optionalUnavailable], aiEnabled,
  };
}
