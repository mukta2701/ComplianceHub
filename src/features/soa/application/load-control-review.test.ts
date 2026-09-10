import { describe, expect, it } from "vitest";
import { controlReviewFixture, finaliseControlReviewFixture } from "@/test/control-review-fixture";
import { loadControlReview } from "./load-control-review";

const context = { organisationId: "org", registerId: "register", today: "2026-09-10" };
describe("loadControlReview", () => {
  it("returns the exact source revision and every committed mapped answer, including unanswered and unmapped controls", async () => {
    const fixture = controlReviewFixture();
    const result = await loadControlReview(fixture.client, context);
    expect(result.register?.sourceAssessment).toEqual({ id: "assessment", title: "Recorded practices", state: "draft", revision: 7, catalogueVersionId: "questions-v1" });
    expect(result.items[0].sourceAnswers).toEqual([
      { questionId: "q1", code: "G1", prompt: "Who reviews access?", answer: "partially", evidenceNote: "Quarterly notes", updatedAt: "2026-09-09T12:00:00Z" },
      { questionId: "q2", code: "G2", prompt: "Are reviews recorded?", answer: null, evidenceNote: "", updatedAt: null },
    ]);
    expect(result.items[1].sourceAnswers.map((answer) => answer.questionId)).toEqual(["q1"]);
    expect(result.items[2].sourceAnswers).toEqual([]);
    expect(result.finalisation.readiness).toBe("ready");
  });
});

it("loads safe ownership, linked work and stored evidence separately from date freshness", async () => {
  const fixture = controlReviewFixture();
  Object.assign(fixture.tables.soa_items[0], { applicable: true, status: "operational", owner_id: "member" });
  const result = await loadControlReview(fixture.client, context);
  expect(result.members).toEqual([{ id: "member", name: "Workspace member" }]);
  expect(result.items[0]).toMatchObject({ ownerName: "Workspace member", evidenceTotal: 1, evidenceExpired: 1, openTaskCount: 1 });
  expect(result.items[0].evidence).toEqual([{ id: "evidence", title: "Review notes", storedStatus: "current", validUntil: "2025-01-01" }]);
  expect(result.items[0].linkedTasks).toEqual([{ id: "task", reference: "task", title: "Record next review", status: "open", dueOn: null }]);
  expect(result.relatedRisks).toEqual([{ id: "risk", reference: "R-001", title: "Access review gap", status: "open", relationship: "assessment" }]);
  expect(result.finalisation.readiness).toBe("ready");
});

it.each([
  "soa_registers", "soa_items", "assessment_sessions", "catalogue_questions", "assessment_responses", "control_catalogue_controls", "assessment_control_mappings", "requirement_control_mappings", "memberships", "evidence_links", "soa_snapshots", "catalogue_versions", "control_catalogue_versions",
])("fails closed when essential %s cannot be read", async (table) => {
  const fixture = controlReviewFixture();
  fixture.failures.add(table);
  const result = await loadControlReview(fixture.client, context);
  expect(result.finalisation.readiness).toBe("could_not_verify");
  expect(result.finalisation.unavailableInputs.length).toBeGreaterThan(0);
  expect(JSON.stringify(result)).not.toContain("private database failure");
});

it.each(["audit_events", "tasks", "risks"])("isolates optional %s failures", async (table) => {
  const fixture = controlReviewFixture();
  fixture.failures.add(table);
  const result = await loadControlReview(fixture.client, context);
  expect(result.finalisation.readiness).toBe("ready");
  expect(result.items).toHaveLength(93);
  expect(result.optionalUnavailable.length).toBeGreaterThan(0);
});

it("scopes tenant records and rejects cross-workspace access without leaking titles", async () => {
  const fixture = controlReviewFixture();
  const result = await loadControlReview(fixture.client, { ...context, organisationId: "different-org" });
  expect(result.finalisation.readiness).toBe("could_not_verify");
  expect(result.register).toBeNull();
  expect(JSON.stringify(result)).not.toContain("Annual control review");
});

it("keeps per-control history and linked-list totals accurate beyond display limits", async () => {
  const fixture = controlReviewFixture();
  fixture.tables.audit_events = Array.from({ length: 510 }, (_, i) => ({ id: `event-${i}`, organisation_id: "org", entity_type: "soa_items", entity_id: "item-0", action: "update", occurred_at: "2026-09-10T09:00:00Z" }));
  fixture.tables.audit_events.push({ id: "quiet-event", organisation_id: "org", entity_type: "soa_items", entity_id: "item-1", action: "insert", occurred_at: "2026-01-01T09:00:00Z" });
  fixture.tables.tasks = Array.from({ length: 25 }, (_, i) => ({ ...fixture.tables.tasks[0], id: `task-${i}`, status: i === 0 ? "done" : "open" }));
  const result = await loadControlReview(fixture.client, context);
  expect(result.items[0].lists.history).toEqual({ total: 510, shown: 5, limit: 5, truncated: true });
  expect(result.items[1].recentAuditEvents).toEqual([{ action: "insert", occurredAt: "2026-01-01T09:00:00Z" }]);
  expect(result.items[0].lists.tasks).toEqual({ total: 25, shown: 20, limit: 20, truncated: true });
  expect(result.items[0].openTaskCount).toBe(24);
});

it("rejects unverifiable counts and truncated essential evidence instead of computing partial readiness", async () => {
  const fixture = controlReviewFixture();
  fixture.missingCounts.add("memberships");
  expect((await loadControlReview(fixture.client, context)).finalisation.readiness).toBe("could_not_verify");
  fixture.missingCounts.clear();
  fixture.tables.evidence_links = Array.from({ length: 5001 }, (_, i) => ({ ...fixture.tables.evidence_links[0], evidence_id: `e-${i}` }));
  expect((await loadControlReview(fixture.client, context)).finalisation).toMatchObject({ readiness: "could_not_verify", unavailableInputs: ["evidence"] });
});

it("reports transport failures safely and distinguishes missing answers from explicit null responses", async () => {
  const fixture = controlReviewFixture();
  fixture.tables.assessment_responses.push({ organisation_id: "org", session_id: "assessment", question_id: "q2", answer: null, evidence_note: "Awaiting confirmation", updated_at: "2026-09-10T11:00:00Z" });
  const result = await loadControlReview(fixture.client, context);
  expect(result.items[0].sourceAnswers[1]).toMatchObject({ answer: null, evidenceNote: "Awaiting confirmation", updatedAt: "2026-09-10T11:00:00Z" });
  fixture.thrown.add("memberships");
  expect((await loadControlReview(fixture.client, context)).finalisation.readiness).toBe("could_not_verify");
});

it("blocks stored expired evidence alongside current evidence but not evidence attached only to excluded decisions", async () => {
  const fixture = controlReviewFixture();
  fixture.tables.evidence_links.push({ ...fixture.tables.evidence_links[0], evidence_id: "expired", evidence: { id: "expired", organisation_id: "org", title: "Old record", status: "expired", valid_until: null, kind: "note" } });
  Object.assign(fixture.tables.soa_items[0], { applicable: true, status: "operational", owner_id: "member" });
  const result = await loadControlReview(fixture.client, context);
  expect(result.finalisation).toMatchObject({ readiness: "blocked", blockers: { expiredEvidence: ["item-0"], missingEvidence: [] } });
  fixture.tables.soa_items[0].applicable = false;
  expect((await loadControlReview(fixture.client, context)).finalisation.readiness).toBe("ready");
});

it.each(["assessment_sessions", "control_catalogue_controls", "catalogue_questions", "memberships"])("does not treat missing essential %s records as verified", async (table) => {
  const fixture = controlReviewFixture();
  fixture.tables[table] = [];
  expect((await loadControlReview(fixture.client, context)).finalisation.readiness).toBe("could_not_verify");
});

it("marks an owner who no longer belongs to the workspace for reassignment without exposing their identifier", async () => {
  const fixture = controlReviewFixture();
  Object.assign(fixture.tables.soa_items[0], { applicable: true, status: "operational", owner_id: "removed-member-id" });
  const result = await loadControlReview(fixture.client, context);
  expect(result.items[0]).toMatchObject({ ownerId: null, ownerName: "Former workspace member", reviewState: "missing_owner" });
  expect(result.finalisation).toMatchObject({ readiness: "blocked", blockers: { unassigned: ["item-0"] } });
});

it("does not attach cross-workspace evidence or pretend a hidden linked record is absent", async () => {
  const fixture = controlReviewFixture();
  fixture.tables.evidence_links[0].evidence = null;
  expect((await loadControlReview(fixture.client, context)).finalisation).toMatchObject({ readiness: "could_not_verify", unavailableInputs: ["evidence"] });
  fixture.tables.evidence_links[0].evidence = { id: "other", organisation_id: "other-org", status: "current" };
  expect((await loadControlReview(fixture.client, context)).finalisation.readiness).toBe("could_not_verify");
});

it("loads immutable snapshot facts even when every changing review input fails", async () => {
  const fixture = controlReviewFixture();
  finaliseControlReviewFixture(fixture);
  for (const table of ["soa_items", "assessment_sessions", "assessment_responses", "memberships", "evidence_links", "assessment_control_mappings", "requirement_control_mappings", "control_catalogue_controls", "tasks", "risks"]) fixture.failures.add(table);
  const result = await loadControlReview(fixture.client, context);
  expect(result.finalisation.readiness).toBe("finalised");
  expect(result.register).toMatchObject({ title: "Saved statement", sourceAssessment: { id: "saved-assessment", catalogueVersionId: "saved-questions", revision: null }, controlCatalogueVersionId: "saved-controls" });
  expect(result.finalisedStatement?.items).toEqual([{ controlCode: "5.1", controlTitle: "Saved security policy", applicable: true, status: "operational", ownerId: "former-owner", justification: "Saved rationale", evidence: "Saved evidence note" }]);
  expect(result.items).toEqual([]);
});


it("exposes both verified catalogue identities and version labels", async () => {
  const fixture = controlReviewFixture();
  const result = await loadControlReview(fixture.client, context);
  expect(result.catalogues).toEqual({
    assessment: { id: "questions-v1", title: "Assessment questions", version: "2026.1" },
    control: { id: "controls-v1", title: "ISO control catalogue", version: "2022.1" },
  });
});

it("rejects an empty control catalogue even when no decision is present to reference it", async () => {
  const fixture = controlReviewFixture();
  fixture.tables.soa_items = [];
  fixture.tables.control_catalogue_controls = [];
  expect((await loadControlReview(fixture.client, context)).finalisation).toMatchObject({ readiness: "could_not_verify", unavailableInputs: ["control catalogue"] });
});

it("rejects decisions belonging to a different control catalogue identity", async () => {
  const fixture = controlReviewFixture();
  fixture.tables.soa_items[0].control_catalogue_version_id = "different-catalogue";
  expect((await loadControlReview(fixture.client, context)).finalisation.readiness).toBe("could_not_verify");
});

it.each(["catalogue_versions", "control_catalogue_versions"])("fails closed when editable %s identity is absent or unavailable", async (table) => {
  const fixture = controlReviewFixture();
  fixture.tables[table] = [];
  expect((await loadControlReview(fixture.client, context)).finalisation.readiness).toBe("could_not_verify");
});

it("uses the snapshot's catalogue labels and preserves saved IDs if those labels are unavailable", async () => {
  const fixture = controlReviewFixture();
  finaliseControlReviewFixture(fixture);
  fixture.tables.catalogue_versions.push({ id: "saved-questions", title: "Saved assessment catalogue", version: "2025.1" });
  fixture.tables.control_catalogue_versions.push({ id: "saved-controls", title: "Saved control catalogue", version: "2022.0" });
  let result = await loadControlReview(fixture.client, context);
  expect(result.catalogues).toEqual({
    assessment: { id: "saved-questions", title: "Saved assessment catalogue", version: "2025.1" },
    control: { id: "saved-controls", title: "Saved control catalogue", version: "2022.0" },
  });
  fixture.failures.add("catalogue_versions");
  fixture.failures.add("control_catalogue_versions");
  result = await loadControlReview(fixture.client, context);
  expect(result.finalisation.readiness).toBe("finalised");
  expect(result.catalogues).toMatchObject({ assessment: { id: "saved-questions", title: null }, control: { id: "saved-controls", title: null } });
  expect(result.optionalUnavailable).toEqual(["Assessment catalogue label", "Control catalogue label"]);
});

it("preserves older immutable statements without inventing owner records or applying today's 93-control gate", async () => {
  const fixture = controlReviewFixture();
  finaliseControlReviewFixture(fixture);
  const items = fixture.tables.soa_snapshots[0].items as Array<Record<string, unknown>>;
  delete items[0].ownerId;
  items[0].status = "implemented";
  const result = await loadControlReview(fixture.client, context);
  expect(result.finalisation.readiness).toBe("finalised");
  expect(result.finalisedStatement?.items[0]).toMatchObject({ status: "implemented", justification: "Saved rationale" });
  expect(result.finalisedStatement?.items[0].ownerId).toBeUndefined();
});

it("does not fall back to mutable decisions when the existing snapshot is malformed", async () => {
  const fixture = controlReviewFixture();
  finaliseControlReviewFixture(fixture);
  fixture.tables.soa_snapshots[0].items = [{ controlCode: "5.1" }];
  expect((await loadControlReview(fixture.client, context)).finalisation).toMatchObject({ readiness: "could_not_verify", unavailableInputs: ["final statement"] });
});
