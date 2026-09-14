# Connected assessment, controls and applicability specification

**Starting commit:** `617780c35fc7bf90c64405386971084cc53eb7ec`

## Problem Statement

ComplianceHub currently presents Gap assessment and Statement of Applicability as separate destinations without showing how a recorded practice informs a later control decision. Completing an assessment returns the coordinator to the assessment list. Creating a Statement of Applicability seeds a control catalogue but does not show the source assessment beside the decisions, so people can reasonably assume that the application converted answers into applicability decisions when it did not.

The working control review is also named after its final formal output. There is no separate Controls destination, although control accountability, tasks, evidence and mappings already exist. Creating another control register would duplicate those records. At the same time, current list failures can appear as empty workspaces, repeated generation can create competing drafts, two coordinators can overwrite one another's control decisions, and interface preflight rules do not fully match the database finalisation contract.

The dashboard's “Continue your baseline” action exposes a related language problem. The Baseline page combines editable programme input with a dated historical snapshot and does not include complete control or Statement of Applicability state. The owner has directed that baseline restructuring follow the connected assessment and control refinement rather than expand this increment.

## Solution

Present one Programme destination named **Controls & applicability** using the existing Statement of Applicability route and records. This is the operating workspace for reviewing controls. Keep **Statement of Applicability** as the name of the versioned formal output and its immutable final snapshot.

Connect the journey explicitly:

1. Scope and objectives describe what the programme covers.
2. A Gap assessment records current practices, supporting notes and gaps.
3. The coordinator continues from the assessment to a control review connected to that exact assessment.
4. Assessment answers appear as current recorded source context only where a committed mapping exists. A person still decides applicability, implementation status, ownership, rationale and evidence.
5. Tasks, risks and evidence remain separate linked records. Task completion does not establish control effectiveness.
6. Finalisation creates the existing immutable Statement of Applicability snapshot after the complete catalogue passes the established review rules.

The Assessment list and detail screens should show progress, state, evidence-note gaps and the relevant next action. The Controls & applicability landing screen should distinguish continuing an existing draft, starting a first control review, reviewing a finalised statement and viewing framework coverage. A register generated from an assessment should expose its source, source completeness and any existing active review before another draft can be created.

The control review should retain its current search and filters while making the decision chain legible: source assessment context, applicability, implementation status, owner, rationale, evidence and linked work. Assessment answers shown in an editable review are the current records at the displayed assessment revision and update time; they are not an archived copy of what a reviewer previously saw. Finalised statements identify their source assessment and catalogue but do not present later-changing answers as historical facts. Missing information and unavailable reads must remain identifiable. Desktop and mobile should expose equivalent decision information and actions.

## User Stories

1. As a compliance coordinator, I want the Programme navigation to say Controls & applicability, so that I know it is the place where control decisions are worked on.
2. As an authorised reviewer, I want Statement of Applicability to describe the formal output, so that I do not confuse a working queue with an approved record.
3. As a compliance coordinator, I want an assessment to show its answered and unanswered totals, so that I can understand whether its context is complete.
4. As a compliance coordinator, I want an assessment to show how many answers lack supporting notes, so that missing support remains visible.
5. As a compliance coordinator, I want a completed assessment to offer Review controls, so that the next programme step is clear.
6. As a compliance coordinator, I want an incomplete assessment to remain usable as a source with a visible limitation, so that early review is possible without pretending the input is complete.
7. As a compliance coordinator, I want to continue an existing active control review for an assessment, so that I do not accidentally create competing drafts.
8. As a compliance coordinator, I want creation to open the existing active control review when one already exists, so that repeated submission is safe.
9. As a compliance coordinator, I want a new version after finalisation to use the existing successor workflow, so that historical formal outputs remain intact.
10. As an authorised reviewer, I want a control review to identify its source assessment, current displayed revision and catalogue versions, so that I can inspect its present decision context without mistaking it for archived provenance.
11. As an authorised reviewer, I want every mapped assessment answer shown beside the relevant controls, so that many-to-many current-practice context is easy to inspect.
12. As an authorised reviewer, I want unmapped controls labelled as having no direct assessment question, so that absence of context is not mistaken for a positive answer.
13. As an authorised reviewer, I want source context labelled as guidance rather than a decision, so that I remain responsible for applicability.
14. As an authorised reviewer, I want to open the exact source assessment from the control review, so that I can inspect its answer and evidence note.
15. As an authorised reviewer, I want to filter controls by theme, applicability, implementation state, missing owner, missing rationale and missing evidence, so that I can find the decisions needing attention.
16. As an authorised reviewer, I want each control to show its applicability, status, owner and rationale in the queue and detail, so that I do not lose decision context while navigating.
17. As an authorised reviewer, I want linked evidence freshness shown separately from implementation status, so that recorded work is not confused with current support.
18. As an authorised reviewer, I want control-linked tasks and assessment/register-related risks to retain their own states and relationship labels, so that control review does not manufacture completion, control-specific risk links or risk acceptance.
19. As one of two coordinators, I want an older browser tab rejected when the same control decision changed elsewhere, so that I do not overwrite newer work.
20. As a coordinator whose save was rejected, I want my draft retained with clear refresh guidance, so that I can reconcile it deliberately.
21. As a coordinator, I want successful saves to advance the displayed technical revision, so that I can continue without false conflicts.
22. As an authorised reviewer, I want finalisation blockers to match the database rules, so that the interface does not demand work the formal contract does not require.
23. As an authorised reviewer, I want a visibly incomplete 93-control catalogue to block finalisation before submission, so that a database rejection is not the first explanation.
24. As an authorised reviewer, I want non-applicable controls to require a rationale without requiring an owner, so that exclusions are justified consistently.
25. As an authorised reviewer, I want applicable controls to require an owner before finalisation, so that accountability is explicit.
26. As an authorised reviewer, I want every applicable control to retain at least one linked evidence record whose stored status is current or expiring, with any linked expired record blocking finalisation, so that visual refinement does not weaken the formal output.
27. As a compliance coordinator, I want Assessment and Controls list failures shown as unavailable with a retry path, so that a failed query is not reported as no work.
28. As a compliance coordinator, I want large assessment and control-review histories presented with accurate totals and explicit display limits or pagination, so that counts and lists remain truthful.
29. As a Member, I want to read assessment and control-decision context without edit actions, so that I can understand the programme within my existing permissions.
30. As a Member, I want linked records limited to information I may open, so that the interface does not offer blocked navigation.
31. As a mobile reviewer, I want the same source, decision, owner, evidence and blocker information available without horizontal page overflow, so that review remains possible on a narrow screen.
32. As a keyboard user, I want filters, control navigation, decision fields and actions reachable with visible focus, so that the workspace is operable without a pointer.
33. As leadership, I want a finalised Statement of Applicability clearly distinguished from current control work, so that I can understand what is fixed, current or still under review.
34. As an auditor, I want finalised statements and their existing exports to remain immutable and versioned, so that the record remains reproducible.
35. As an authorised reviewer, I want failed evidence, mapping, ownership or catalogue-completeness reads to block a ready-to-finalise state, so that unavailable verification cannot become zero blockers.
36. As a compliance coordinator, I want existing duplicate active reviews displayed and one recommended deterministically, so that no historical draft is hidden or deleted.
37. As a compliance coordinator, I want a successor review to preserve owners who remain workspace members and flag removed owners for reassignment, so that copied accountability is neither lost nor invented.
38. As a coordinator confirming an import preview, I want every imported control change checked against the decision revision I previewed, so that an import cannot overwrite newer interactive work.

## Implementation Decisions

- Keep the existing application stack, routes and control/Statement of Applicability persistence. The Programme navigation label changes to Controls & applicability; a separate editable control register is not introduced.
- Use Control review for the editable register and Statement of Applicability for the formal versioned output. Preserve existing URLs and historical links.
- Keep assessment answers, control decisions, tasks, risks, evidence freshness, human review and provider verification distinct.
- Preserve the existing answer and evidence-note autosave behaviour, completion rules and Member read-only access.
- Add an explicit assessment-to-control-review handoff. Completing an assessment does not automatically generate a review, and incomplete assessments remain selectable with an explicit limitation.
- Treat a control review with no final snapshot as active. Route every authenticated first-review creation through one transactional create-or-reuse command and remove direct authenticated register insertion that could bypass it. Use the existing organisation-wide transaction lock before allocating the organisation-wide register version; within that transaction, reuse an active review for the selected assessment before inserting. Repeated generation for the same assessment atomically returns an active review rather than inserting a competing draft. If historical duplicates already exist, retain and display all of them; recommend the active review with the latest authoritative register activity time, then highest version and identifier as deterministic tie-breakers. Do not silently merge or delete existing drafts. Service-role maintenance remains an explicitly privileged boundary rather than an ordinary application creation path.
- Repair and expose the successor command needed to begin a later version from a finalised statement. Successor creation uses the same organisation-wide version-allocation lock and assessment-specific active-review reuse in one transaction. It returns an existing active review if one appeared concurrently. Copy a source owner only when that person remains a workspace member; otherwise leave the copied decision unassigned and flag it for review. New successor decision rows begin at the initial technical revision rather than inheriting the source row's edit history. Preserve the immutable source statement.
- Display source context only through committed assessment-to-control mappings from the source assessment's exact catalogue version. Load and group every mapped question for each control; the relationship is many-to-many. Do not infer mappings from similar wording or automatically persist the existing in-memory status suggestions.
- Source context includes assessment identity, state, currently displayed revision, question code and prompt, recorded answer, supporting note and update time where available. Null answers and missing notes stay explicit. An editable control review reads the current assessment context; it does not claim to preserve the answer seen when a control decision was saved.
- Finalised statements retain their existing assessment identity and catalogue provenance. They do not embed or display later-changing assessment answers as if those answers were part of the immutable snapshot; opening the source assessment is clearly labelled as viewing its current record.
- Add a monotonic technical revision to editable control decisions. Route interactive saves and confirmed import updates through the same guarded database command, compare the revision displayed or previewed by the editor, and advance it once on success. Every confirmed decision or import update also advances the parent register's `updated_at`; this is the authoritative activity time used for deterministic active-review ordering. Import confirmation is atomic: if any targeted decision is stale, no imported decision is written and the coordinator must preview again. Remove direct authenticated decision updates that could bypass revision advancement. Stale, missing and cross-workspace updates affect no row and return a stable recoverable result.
- Keep decision revision separate from formal Statement of Applicability version numbers and control implementation status.
- Centralise control-review reads behind one module interface that loads the register, source assessment context, decision rows, safe member labels, linked work/evidence, history and completeness. Register, item, source assessment, catalogue/mapping, membership and evidence reads are essential wherever they determine provenance, ownership validity or finalisation readiness. Failure of any essential preflight input must show “could not verify” and block a ready state. Audit history, control-linked task display and assessment/register-related risk display may fail independently when the affected context is identified as unavailable.
- Paginate or explicitly cap assessment and control-review lists. Summary totals must describe the complete stated population rather than one fetched page.
- Reconcile interface finalisation guidance with the existing database contract: all 93 catalogue controls must exist; every control needs a justification; applicable controls cannot remain pending and need an owner; non-applicable controls do not need an owner. Every applicable control needs at least one linked evidence record whose stored status is current or expiring, and any linked evidence record with stored status expired blocks finalisation. Separately derived date-based freshness remains visible guidance and does not silently change that persisted-status contract in this increment.
- Preserve database authorisation as the source of truth and retain existing Owner/Admin editing and Member reading boundaries. Server actions should return stable permission and conflict errors rather than exposing provider details.
- Retain existing audit history and immutable final snapshots. Avoid a global history cap that can silently omit all history for less-active controls; displayed history limits must be per decision or explicit.
- Refresh affected assessment, Controls & applicability, framework-coverage and linked-record views only after confirmed persistence.
- Keep visual language consistent with the polished Dashboard, Tasks, Risks, Assets and Policies areas: restrained blue/neutral palette, compact metrics, obvious next action, responsive record cards, readable forms and visible status distinctions.
- Do not restructure Baseline in this increment. The approved later direction is Scope & objectives for information entry and Saved programme reviews for dated history. Preserve current baseline links until that later migration is specified.

## Testing Decisions

- Test through existing public seams: assessment pages and actions, control-review page and action interfaces, database commands/RLS, and production browser journeys. Avoid tests coupled to CSS class names or private helper layout.
- Use vertical red-green slices. First prove the connected assessment handoff and active-review reuse, then source-context rendering, then stale-decision protection, then finalisation parity and truthful read failures.
- Preserve and extend existing assessment autosave/conflict/completion tests, control-review filtering and finalisation tests, tenant isolation, Member read-only tests and immutable snapshot/export tests.
- Database tests must demonstrate exact organisation scoping, one active review returned under repeat/concurrent creation and successor requests, denial of direct authenticated register/decision writes, deterministic handling of preserved duplicate drafts, valid-owner successor copying, removed-owner reassignment flags, compare-and-set interactive and import decision updates, atomic stale-import zero-write behaviour, revision advancement, existing finalisation guards and immutable completed outputs.
- Page/action tests must demonstrate source assessment identity and limitations, current-versus-archived context labels, multiple questions mapped to one control, one question mapped to multiple controls, null responses, unmapped controls, complete counts, explicit caps, unavailable states, role-appropriate links, retained conflicting drafts and recovery messages. A failed essential evidence, mapping, membership or catalogue read must never report zero blockers or ready to finalise. Import tests must prove a stale preview cannot overwrite an intervening interactive save.
- Production browser tests use fictional data to demonstrate assessment answer/save/completion, handoff, control-review creation/reuse, mapped context, decision save, stale-tab rejection, blockers and final Statement of Applicability distinction.
- Inspect representative desktop, tablet and narrow mobile views for assessment list/detail, Controls & applicability landing and populated 93-control review. Check keyboard reachability, focus, labels, associated errors, loading/empty/error recovery, unintended overflow and serious/critical automated accessibility violations.
- Run focused and full unit checks, relevant integration and database permission suites, typecheck, lint and production build. Complete independent standards and specification reviews against the recorded starting commit and resolve material findings before closeout.

## Out of Scope

- Automatic scope discovery, automated objective approval, integration-driven scope drift, baseline relocation and expanding saved baseline payloads.
- A second control library, a new `/app/controls` persistence model, replacing the shared control catalogue, adding control-specific risk relationships or changing cross-framework mapping semantics.
- Automatically deriving or persisting applicability, implementation status, ownership, rationale, risks or tasks from assessment answers.
- New assessment questions, catalogue mappings, control requirements, implementation statuses, permission roles or approval rules.
- Treating a completed task, fresh evidence, accepted contribution, provider result or assessment answer as proof of control effectiveness.
- Rich-text rationale, bulk AI decisions, automated finalisation, electronic signatures, immutable snapshots of every assessment answer, destructive historical migration or deletion of existing duplicate drafts.
- Hosted deployment, live-provider verification, certification claims, screen-reader acceptance and intended-user acceptance.

## Further Notes

The owner approved this information architecture after independent Astra product, Sol code and Luna visual investigations. Existing duplicates and historical statements remain preserved; the new creation path prevents further accidental duplicates. Any data repair requires a separate evidence-backed decision.

This specification defines one connected programme increment. It does not claim that the existing Baseline snapshot is a complete control or compliance record. The release checklist remains the sole overall status source, and implementation, automated checks, local browser demonstration, provider verification, hosted release and human acceptance remain separate evidence levels.
