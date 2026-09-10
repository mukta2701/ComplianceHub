import { createClient } from "@supabase/supabase-js";

let fixtureNumber = 0;
type Row = Record<string, unknown>;
export function controlReviewFixture() {
  const tables: Record<string, Row[]> = {
    soa_registers: [{ id: "register", organisation_id: "org", title: "Annual control review", version: 2, updated_at: "2026-09-10T10:00:00Z", assessment_session_id: "assessment", control_catalogue_version_id: "controls-v1" }],
    soa_snapshots: [],
    catalogue_versions: [{ id: "questions-v1", title: "Assessment questions", version: "2026.1" }],
    control_catalogue_versions: [{ id: "controls-v1", title: "ISO control catalogue", version: "2022.1" }],
    soa_items: Array.from({ length: 93 }, (_, i) => ({ id: `item-${i}`, organisation_id: "org", soa_register_id: "register", control_catalogue_version_id: "controls-v1", control_id: `control-${i}`, control_code: `5.${i + 1}`, control_title: `Control ${i + 1}`, applicable: false, status: "not_applicable", justification: "Outside the recorded scope", evidence: "", owner_id: null, position: i, decision_revision: 0 })),
    assessment_sessions: [{ id: "assessment", organisation_id: "org", title: "Recorded practices", state: "draft", revision: 7, catalogue_version_id: "questions-v1" }],
    catalogue_questions: [
      { id: "q1", catalogue_version_id: "questions-v1", code: "G1", prompt: "Who reviews access?", position: 0 },
      { id: "q2", catalogue_version_id: "questions-v1", code: "G2", prompt: "Are reviews recorded?", position: 1 },
      { id: "q-other", catalogue_version_id: "questions-v2", code: "G1", prompt: "New question", position: 0 },
    ],
    assessment_responses: [{ organisation_id: "org", session_id: "assessment", question_id: "q1", answer: "partially", evidence_note: "Quarterly notes", updated_at: "2026-09-09T12:00:00Z" }],
    control_catalogue_controls: Array.from({ length: 93 }, (_, i) => ({ id: `control-${i}`, catalogue_version_id: "controls-v1", theme: "organisational", position: i + 1 })),
    assessment_control_mappings: [{ catalogue_question_id: "q1", control_id: "control-0" }, { catalogue_question_id: "q2", control_id: "control-0" }, { catalogue_question_id: "q1", control_id: "control-1" }, { catalogue_question_id: "q-other", control_id: "control-0" }],
    requirement_control_mappings: [{ requirement_id: "control-0", control_id: "shared" }],
    memberships: [{ organisation_id: "org", user_id: "member", profiles: { display_name: "  " } }],
    evidence_links: [{ organisation_id: "org", control_id: "shared", evidence_id: "evidence", evidence: { id: "evidence", organisation_id: "org", title: "Review notes", status: "current", valid_until: "2025-01-01", kind: "note" } }],
    tasks: [{ id: "task", organisation_id: "org", control_id: "shared", title: "Record next review", status: "open", due_on: null }],
    audit_events: [],
    risks: [{ id: "risk", organisation_id: "org", reference: "R-001", title: "Access review gap", status: "open", source_assessment_session_id: "assessment", source_soa_register_id: null }],
    ai_workspace_settings: [{ organisation_id: "org", enabled: false }],
  };
  const failures = new Set<string>();
  const thrown = new Set<string>();
  const missingCounts = new Set<string>();
  const requests: URL[] = [];
  const client = createClient("http://fixture.local", "fictional-key", { global: { fetch: async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    const table = url.pathname.split("/").at(-1)!;
    if (thrown.has(table)) throw new DOMException("private network failure", "AbortError");
    if (failures.has(table)) return new Response(JSON.stringify({ message: "private database failure" }), { status: 500 });
    let rows = [...(tables[table] ?? [])];
    for (const [field, condition] of url.searchParams) {
      if (condition.startsWith("eq.")) rows = rows.filter((row) => String(row[field]) === condition.slice(3));
      if (condition.startsWith("in.(")) {
        const values = condition.slice(4, -1).split(",").map((value) => value.replaceAll('"', ""));
        rows = rows.filter((row) => values.includes(String(row[field])));
      }
    }
    const order = url.searchParams.get("order");
    if (order) for (const part of order.split(",").reverse()) {
      const [key, direction] = part.split(".");
      rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (direction === "desc" ? -1 : 1));
    }
    const total = rows.length;
    rows = rows.slice(0, Number(url.searchParams.get("limit") ?? total));
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (!missingCounts.has(table)) headers["content-range"] = `0-${Math.max(0, rows.length - 1)}/${total}`;
    return new Response(init?.method === "HEAD" ? null : JSON.stringify(rows), { status: 200, headers });
  } }, auth: { persistSession: false, autoRefreshToken: false, storageKey: `fixture-${fixtureNumber++}` } });
  return { client, tables, failures, thrown, missingCounts, requests };
}

export function finaliseControlReviewFixture(fixture: ReturnType<typeof controlReviewFixture>) {
  fixture.tables.soa_snapshots = [{
    id: "snapshot", organisation_id: "org", soa_register_id: "register", title: "Saved statement",
    version: 2, organisation_name: "Fictional company", finalised_at: "2026-08-01T12:00:00Z", finalised_by: "former-reviewer",
    assessment_session_id: "saved-assessment", catalogue_version_id: "saved-questions", control_catalogue_version_id: "saved-controls",
    items: [{ controlCode: "5.1", controlTitle: "Saved security policy", applicable: true, status: "operational", ownerId: "former-owner", justification: "Saved rationale", evidence: "Saved evidence note" }],
  }];
}
