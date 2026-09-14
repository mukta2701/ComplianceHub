# Connected Controls & Applicability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task by task.

**Goal:** Turn Gap assessment and the existing Statement of Applicability records into one clear, reliable operating journey where people can understand assessment progress, start or resume the right control review, make protected decisions, and distinguish current work from a formal finalised statement.

**Architecture:** Preserve the existing Next.js App Router, Supabase tables, `/app/assessment` and `/app/soa` routes. Add transactional database commands for review creation and guarded decision writes, then centralise the control-review read model so page rendering, finalisation preflight and visual summaries use the same truthful inputs. Present the existing `soa_registers`/`soa_items` records as the editable Control review and reserve Statement of Applicability for immutable snapshots.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript, Supabase/Postgres, Vitest, React Testing Library, pgTAP and Playwright.

**Spec:** `docs/superpowers/specs/2026-09-10-connected-controls-applicability.md`

## Global Constraints

- Work only in `codex/team-baseline`; preserve fictional local records and the existing application stack.
- Treat assessment answers as current source context. Never convert them into applicability or implementation decisions automatically.
- Keep task completion, evidence freshness, human review and provider verification separate.
- Keep `/app/soa` URLs and existing final exports working. Change the navigation label to **Controls & applicability** and use **Statement of Applicability** for the formal output.
- Preserve current role permissions and Row Level Security. Every Server Action must re-check authentication, workspace membership and capability.
- Use the organisation-wide advisory lock before allocating an organisation-wide register version. Reuse an active review for the selected assessment inside the same transaction.
- Use one monotonic technical revision per editable decision. Interactive saves and imports must share the same guarded write command.
- Essential read failures must say that verification is unavailable and must block finalisation. They must never become zero blockers or an empty-state success.
- Follow red-green-refactor for meaningful behaviour. Do not weaken existing tests to make a change pass.
- After each task: run its focused checks, request an independent review, resolve material findings, commit the coherent change and push `origin/codex/team-baseline`.
- Before coding, follow the checked-in Next.js 16.3 guides under `node_modules/next/dist/docs/`, especially App Router pages, forms/Server Actions, authentication and accessibility.

---

## Task 1: Make the assessment-to-control journey visible

**User-visible outcome:** The Programme navigation, assessment register and assessment detail page explain where the user is, how complete the assessment is, and whether the next action starts or resumes a control review.

**Demonstration:** With fictional completed and incomplete assessments, `/app/assessment` shows answered totals, missing evidence-note totals, state and a clear next action; the detail page offers **Review controls** without claiming the answers made control decisions; Members can see context but cannot create or edit.

**Files:**

- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/app-shell.test.tsx`
- Modify: `src/app/app/assessment/page.tsx`
- Add: `src/app/app/assessment/page.test.tsx`
- Modify: `src/app/app/assessment/[id]/page.tsx`
- Modify: `src/app/app/assessment/[id]/page.completion.test.tsx`
- Modify: `src/components/assessment-response-form.tsx`
- Modify: `src/components/assessment-response-form.test.tsx`
- Modify: the existing global/component stylesheet that currently owns assessment workspace classes; do not introduce page-level inline-style sprawl.

### Interfaces

Add a server-side assessment list view model with these fields, whether implemented locally in the page or in a small application module:

```ts
type AssessmentRegisterItem = {
  id: string;
  title: string;
  state: "draft" | "completed";
  revision: number;
  updatedAt: string;
  answered: number;
  questions: number;
  missingEvidenceNotes: number;
  activeReviewId: string | null;
  activeReviewVersion: number | null;
};
```

`AssessmentResponseList` receives an optional `controlReviewHref?: string` and, after successful completion, routes to the assessment detail URL with a completion message. The server-rendered detail page owns the authoritative start/resume action. Do not let a client-side completion response invent review state.

### Steps

1. Write failing navigation tests asserting the Programme item is labelled **Controls & applicability** while its href remains `/app/soa`.
2. Write failing assessment page tests for completed/incomplete progress, missing supporting notes, active-review resume links, unavailable-query treatment, display limits and Member read-only actions.
3. Write a failing completion test proving successful completion returns to the assessment detail and exposes the control-review handoff; keep failed/conflicting saves on the question.
4. Implement scoped, checked queries for session totals, responses and active reviews. Use explicit caps or pagination and show an unavailable panel with retry when required reads fail.
5. Replace the flat register rows with a polished card/list layout: progress bar, state, revision/update metadata, missing-note cue and one primary next action. Use semantic headings, links and visible focus.
6. Add the assessment detail journey header and source-context explanation. An incomplete assessment may start a review, but the action must display the limitation. A completed assessment must say that a reviewer still decides applicability.
7. Make the responsive layout stack cleanly at narrow widths and preserve equivalent information without horizontal page overflow.
8. Run focused Vitest tests for app shell, assessment page/detail and response form. Run lint/typecheck for touched code.

---

## Task 2: Make review creation and successors atomic

**User-visible outcome:** Starting the same review twice opens the same active workspace; after a finalised statement, a visible new-version action safely creates or reuses its successor and preserves only valid owners.

**Demonstration:** Repeated and concurrent fictional creation requests return one active review. A successor keeps owners who remain workspace members, leaves removed owners unassigned and preserves the finalised source.

**Files:**

- Add: `supabase/migrations/20260910000000_connected_control_review_creation.sql`
- Add: `supabase/tests/101_connected_control_review_creation.sql`
- Modify: `src/app/app/actions.ts`
- Modify: `src/app/app/actions.soa.test.ts`
- Modify: `src/app/app/soa/page.tsx`
- Modify: `src/app/app/soa/page.scope.test.tsx`

### Database interfaces

Replace ordinary authenticated creation with RPCs whose stable result is a register UUID:

```sql
create or replace function public.create_or_reuse_soa_review(target_assessment_session_id uuid)
returns uuid

create or replace function public.create_or_reuse_soa_successor(source_register_id uuid)
returns uuid
```

Both functions must:

- derive organisation/user from authenticated context and reject an unauthorised role;
- take the existing organisation-wide transaction advisory lock before `max(version) + 1`;
- check for an active register for the chosen assessment inside that transaction;
- deterministically return the active register with greatest `updated_at`, then version, then id if historical duplicates exist;
- create exactly one 93-row decision set when no active register exists;
- preserve the source assessment and catalogue provenance;
- for successors, copy decisions and evidence text, reset technical edit revision to its initial value, preserve an owner only if that person is still a member, and never change the finalised source.

Revoke direct authenticated access to any older draft/successor RPC that bypasses these guarantees; retain service-role maintenance only where already intentional.

### Steps

1. Write failing pgTAP tests for workspace scope, role authority, same-assessment reuse, cross-assessment organisation-wide version allocation, concurrent-safe structure, catalogue cardinality and successor owner rules.
2. Implement the migration with stable search path, RLS-compatible workspace checks and transaction-scoped advisory locking.
3. Write failing action tests proving `createSoaAction` and the successor action call only the new RPCs, redirect to the returned workspace and never insert registers directly.
4. Update the actions and add the new-version action to finalised-register presentation on the landing page.
5. Update the Controls & applicability landing to distinguish **Continue active review**, **Start control review**, **Review finalised statement** and **Create next version**. Display every historical duplicate active review while marking the deterministic recommendation.
6. Run migration lint if available, focused pgTAP, SoA action/page tests, typecheck and lint.

---

## Task 3: Protect interactive and imported control decisions

**User-visible outcome:** A reviewer cannot silently overwrite a newer decision from another tab or import; their typed draft remains visible with a clear refresh/reconcile instruction.

**Demonstration:** Two fictional coordinators edit the same control revision: the first save succeeds and advances the revision; the second receives a recoverable stale result. An import with any stale preview revision writes zero decisions.

**Files:**

- Add: `supabase/migrations/20260910000001_guard_control_review_decisions.sql`
- Add: `supabase/tests/102_guard_control_review_decisions.sql`
- Modify: `src/app/app/actions.ts`
- Modify: `src/app/app/actions.soa.test.ts`
- Modify: `src/app/app/imports/actions.ts`
- Modify: `src/app/app/imports/actions.test.ts` and/or the focused existing SoA import action test file
- Modify: `src/app/app/imports/import-wizard.tsx`
- Modify: `src/app/app/imports/import-wizard.test.tsx`
- Modify: `src/app/app/soa/[id]/soa-review-workspace.tsx`
- Modify: `src/app/app/soa/[id]/soa-review-workspace.test.tsx`

### Database interfaces

Add `soa_items.decision_revision bigint not null default 0` and use one guarded command for all authenticated writes:

```sql
create or replace function public.update_soa_decisions_guarded(
  target_register_id uuid,
  changes jsonb
) returns table(item_id uuid, decision_revision bigint);
```

Each JSON change contains `itemId`, `expectedRevision`, `applicable`, `status`, `justification`, `evidence` and `ownerId`. The command must validate all rows before writing any row, reject cross-workspace/finalised/missing/stale/invalid-owner changes with stable error codes, update each revision once, and advance `soa_registers.updated_at` once per successful command.

### Application interfaces

```ts
type SaveSoaDecisionResult =
  | { status: "saved"; revision: number }
  | { status: "stale" | "missing" | "forbidden"; message: string };
```

The import preview payload must retain the exact decision revision per matched row and a preview identity tied to the selected register/mapping/file. Confirmation submits all changes in one RPC call; any stale result requires a fresh preview.

### Steps

1. Write failing pgTAP tests for revision advancement, stale rejection, atomic multi-row rollback, membership/role/register boundaries, finalised immutability and parent activity time.
2. Implement the schema and guarded RPC. Remove authenticated direct-update grants or paths that bypass it.
3. Write failing Server Action tests for successful/stale/missing/forbidden results and preserved workspace scoping.
4. Change the client save contract to send the displayed revision. On stale response, keep the local draft, announce the conflict, disable further saves for that row and provide a refresh link/button.
5. Write failing import preview/confirm tests proving revisions are retained, a stale row prevents every write, and a successful confirm advances every targeted revision.
6. Route SoA imports through the guarded RPC in one call. Preserve existing row-level validation feedback before confirmation.
7. Run focused pgTAP, action, workspace and import tests plus lint/typecheck.

---

## Task 4: Centralise the truthful control-review read model

**User-visible outcome:** The review workspace shows assessment provenance, every mapped answer, ownership, evidence freshness and linked work from one consistent source, and it refuses to claim readiness when essential data cannot be checked.

**Demonstration:** A mapped control displays all current assessment questions/answers and their update time; an unmapped control says there is no direct assessment question; simulated essential failures display **Could not verify** and block finalisation while optional failures identify only the affected context.

**Files:**

- Add: `src/features/soa/application/load-control-review.ts`
- Add: `src/features/soa/application/load-control-review.test.ts`
- Modify: `src/features/soa/application/finalisation.ts`
- Modify: `src/features/soa/application/finalisation.test.ts`
- Modify: `src/features/soa/application/review-queue.ts`
- Modify: `src/features/soa/application/review-queue.test.ts`
- Modify: `src/app/app/soa/[id]/page.tsx`
- Add or modify: the focused page-loading test for `src/app/app/soa/[id]/page.tsx`

### Interfaces

```ts
type ControlSourceAnswer = {
  questionId: string;
  code: string;
  prompt: string;
  answer: "yes" | "partially" | "no" | "not_applicable" | null;
  evidenceNote: string;
  updatedAt: string | null;
};

type ControlReviewLoadResult = {
  register: {
    id: string;
    title: string;
    version: number;
    updatedAt: string;
    sourceAssessment: {
      id: string;
      title: string;
      state: string;
      revision: number;
      catalogueVersionId: string;
    };
    finalisedSnapshotId: string | null;
  };
  items: Array<SoaQueueItem & {
    decisionRevision: number;
    sourceAnswers: ControlSourceAnswer[];
    linkedTasks: Array<{ id: string; reference: string; title: string; status: string }>;
    evidence: Array<{ id: string; title: string; storedStatus: string; validUntil: string | null }>;
  }>;
  relatedRisks: Array<{ id: string; reference: string; title: string; status: string; relationship: "assessment" | "register" }>;
  finalisation: {
    readiness: "ready" | "blocked" | "could_not_verify";
    blockers: SoaFinalisationBlockers;
    unavailableInputs: string[];
  };
  optionalUnavailable: string[];
};
```

### Steps

1. Write failing loader tests for organisation scope, exact source catalogue version, many-to-many mappings, null/missing answers, unmapped controls, safe member labels, linked evidence/tasks and assessment/register-level risk labels.
2. Write failure-path tests for every essential input: register, items, source assessment, catalogue/mappings, membership and evidence. Each failure must produce `could_not_verify`; no error may be coerced to an empty success.
3. Write optional-failure tests for audit history, linked tasks and related-risk context. Return an affected-context warning without hiding the rest of the review.
4. Implement `loadControlReview` and replace the page’s parallel ad hoc queries with it.
5. Align `collectSoaFinalisationBlockers` with the exact database contract: 93 items; rationale on every item; pending only blocks applicable items; owner required only for applicable items; applicable items need linked evidence whose stored status is current/expiring; any linked expired evidence blocks. Keep derived `valid_until` freshness visible but separate from this persisted-status gate.
6. Add query caps/pagination metadata for history and linked lists; show accurate totals where lists are limited.
7. Run focused loader/domain/page tests plus typecheck and lint.

---

## Task 5: Deliver the polished Controls & applicability workspace

**User-visible outcome:** The landing page and populated review feel like one intentional product: strong hierarchy, graphical progress, a clear decision chain, focused filters and responsive control editing.

**Demonstration:** On desktop, tablet and mobile, fictional reviewers can understand progress at a glance, trace a control to source answers, edit authorised decisions, inspect evidence/work and see exact finalisation blockers. Keyboard focus and screen-reader labels remain clear.

**Files:**

- Modify: `src/app/app/soa/page.tsx`
- Modify: `src/app/app/soa/page.scope.test.tsx`
- Modify: `src/app/app/soa/[id]/page.tsx`
- Modify: `src/app/app/soa/[id]/soa-review-workspace.tsx`
- Modify: `src/app/app/soa/[id]/soa-review-workspace.test.tsx`
- Modify: `src/features/soa/application/review-queue.ts`
- Modify: the existing application stylesheet(s) that own page, card and SoA workspace classes
- Add: `e2e/connected-controls.spec.ts`

### Visual direction

- Continue the existing restrained blue/neutral design used by the refined dashboard, policy, risk and asset workspaces.
- Landing: compact programme-step strip; active-review and formal-statement sections; graphical ring/bar summaries; strong primary next action; no decorative chart without actionable meaning.
- Review header: title/version/state, source assessment link/revision, last activity and formal-output explanation.
- Summary: total, needs attention, reviewed, missing rationale, evidence gaps and unassigned, using one accessible progress visual and labelled counts.
- Workspace: sticky filter/search region at desktop; responsive filters; scan-friendly rows with code/title/domain, source-answer cue, decision status, owner, rationale/evidence summary and attention reason.
- Selected control: visible chain `assessment context → decision → accountability → evidence → linked work`; labels explain that assessment context guides but does not decide.
- Mobile: one-column cards, no horizontal page overflow, filter drawer/stack, equivalent information and reachable actions.

### Steps

1. Write failing component tests for the landing distinctions, graphical summary accessible names, mapped/unmapped source context, current-context warning, filtered attention states, Member read-only mode, unavailable inputs and exact finalisation blockers.
2. Implement the landing structure using the Task 1/2 view data. Remove remaining page-level inline-style clusters in favour of named responsive classes.
3. Extend `SoaQueueItem` presentation data without merging source answers, implementation status, evidence freshness or task state.
4. Build the selected-control source and decision panels. Show every mapped answer; provide a source assessment link; label related risks by assessment/register relationship only.
5. Rework summary cards and filters around the documented attention states. Keep native labels, visible focus, status text beyond colour and clear loading/save/conflict feedback.
6. Implement responsive styles and verify representative widths around 1440, 1024 and 390 pixels. Fix wrapping, touch targets, focus order and contrast issues found during inspection.
7. Add a focused Playwright journey with fictional data covering assessment handoff, active-review reuse, control filtering/source context, protected save, Member read-only behavior and formal-output distinction.
8. Run focused Vitest, Playwright, axe/accessibility checks, lint, typecheck and build.

---

## Task 6: Independent review, demonstration and release evidence

**Outcome:** The full increment is independently reviewed, running from the pushed source and documented without overstating local proof.

**Files:**

- Add: `docs/evidence/2026-09-10-connected-controls-applicability.md`
- Modify: `docs/release-checklist.md`
- Add screenshots only under the repository’s established fictional evidence location; never commit private records, credentials, runtime logs or generated secrets.

### Steps

1. Run the full unit suite, database suite, typecheck, lint and production build. Run database upgrade verification because migrations changed.
2. Use the Matt Pocock `code-review` skill against starting commit `617780c35fc7bf90c64405386971084cc53eb7ec` and this specification. Obtain independent standards and specification reviews; resolve every material finding and rerun affected checks.
3. Start the production-like local preview at the repository’s current canonical review port without erasing records. Confirm `/api/health` reports the exact final commit and database health.
4. Demonstrate the journey with realistic fictional coordinator, reviewer and Member roles. Capture desktop and mobile before/after images for Assessment, Controls & applicability landing and populated control review.
5. Record separately: code implemented, automated checks passed, local fictional behavior demonstrated, live-provider verification, hosted release and human acceptance. Do not use local proof for the last three.
6. Update the plain-language status at the top of `docs/release-checklist.md`, link the evidence, commit and push the final evidence batch.
7. Show the running application in the in-app browser and report using the repository’s four required completion headings.

## Acceptance Criteria

- The full user stories and decisions in the linked specification are implemented or named as unfinished with a precise external dependency.
- Assessment and control-review list failures remain visibly unavailable.
- The interface cannot create competing same-assessment reviews through ordinary authenticated paths.
- Interactive and imported control decisions cannot overwrite a newer revision.
- Finalisation preflight matches the current database contract and blocks when essential data cannot be verified.
- Assessment source context is complete, many-to-many, current-labelled and never presented as an automated decision or frozen snapshot.
- The revised desktop, tablet and mobile journey is intentionally styled, keyboard-operable and locally demonstrated with fictional data.
- Focused, full and database checks pass; material independent-review findings are resolved.
- The final source and evidence are committed and pushed to `origin/codex/team-baseline`; the local review app reports that exact release identity.
