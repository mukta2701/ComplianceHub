# Team baseline implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Demonstrate a saved starting position, assigned-owner contribution, coordinator review and a source-linked leadership explanation using fictional local data.

**Architecture:** Keep the existing Next.js modular application, Supabase authentication, Postgres and private evidence store. Add narrow transactional submission/review operations and immutable baseline snapshots. Reuse existing task, scope, assessment, evidence and report records.

**Tech Stack:** Installed Next.js 16.3 / React 19, TypeScript, Supabase Postgres, Vitest, pgTAP and Playwright.

**Spec:** ../specs/2026-09-09-compliancehub-focused-architecture-design.md

## Global Constraints

- Mukta operates, assigned owners contribute, Charlie reviews; target organisation has at least around 20 staff.
- All work is in the isolated codex/team-baseline worktree. Existing local demo stays available at port 3100. Test database and preview use separate local ports and fictional records.
- No hosted migration, provider write, notification delivery, default-branch merge or deployment. Commit and push every coherent verified change to the active feature branch; never publish credentials or runtime artifacts.
- Read installed Next documentation before app changes and the Supabase skill before database work. Keep service credentials out of application mutation paths and browser code.
- A submission is not review, review is not task completion, task completion is not technical resolution. Old reports and historical evidence remain unchanged.
- Show visible before/after evidence for UI changes and sanitised checks for backend changes. Maintain docs/release-checklist.md as the only reader-facing status tracker.

### Task 1: Assigned contribution and coordinator review

**Files:** create a migration using Supabase CLI for task contributions; create supabase/tests/database/097_task_contributions.sql; extend the reviewed inventory in 047_member_read_only_access.sql; create src/features/tasks/domain/contributions.ts and its tests; create src/app/app/tasks/contribution-actions.ts and its tests; create src/app/app/tasks/task-contributions.tsx and its tests; modify src/app/app/tasks/[id]/page.tsx and src/app/app/tasks/page.tsx; update docs/access-control-matrix.md.

**Interfaces:** Existing tasks.id, organisation_id, owner_id, updated_at and status remain authoritative. New public.task_contributions holds immutable note submission payload, submitter, task assignment revision, timestamps, review decision/rationale/reviewer and resulting evidence id. Database functions submit_task_contribution and review_task_contribution are the only authenticated write paths. Exact typed RPC parameter names are recorded in implementation for Task 2. Task 2 reads pending, accepted and changes_requested states joined by task and organisation.

- [x] Write failing domain/action/database tests: assigned owner submits a note; unrelated member, other tenant, removed member, stale assignment and closed task are denied; direct writes denied; self-review denied; coordinator requests changes then owner resubmits; accepting creates one linked note evidence record; retrying an identical request returns the original result, mismatched reuse rejects; concurrent pending submissions cannot duplicate; acceptance leaves task and findings statuses unchanged.
- [x] Run the focused test before production code and retain failing output in ignored artifacts/team-baseline.
- [x] Implement transaction functions with current membership/assignment checks, safe search path, row locks, request idempotency and narrow grants. Use assignment revision that changes on owner changes (including away and back), not a client-trusted role or timestamp alone. One pending submission per task. Review operates on exact immutable submission id, rechecks stale assignment, and rejects self-review even for an operator. Changes-requested and accepted records remain immutable; resubmission creates a successor. First slice supports note evidence with optional external source URL in the note; file upload permissions remain existing operator-only.
- [x] Add assigned-work filtering/link and pending-review queue to existing Tasks surface without navigation redesign. Task detail shows submit form only to active assignee, review form only eligible coordinator, human-readable history and validation errors. Contributor may describe blocked progress in their note; no broad Member task updates.
- [x] Run focused Vitest tests, database permissions/behavior tests on the isolated database, full typecheck and lint. Self-review diff, commit only intended files. Report exact evidence and limitations; controller handles push and independent review.

### Task 2: Resumable baseline and dated leadership explanation

**Files:** create baseline migration via CLI and supabase/tests/database/098_workspace_baselines.sql; create src/features/baselines/domain/summary.ts and tests; create src/app/app/baseline/actions.ts, page.tsx, baseline-form.tsx and tests; modify existing dashboard to add Continue your baseline link. Update reviewed table inventory and access matrix.

**Interfaces:** Consume Task 1 task_contributions decisions with existing tasks, evidence, scope profiles and assessment sessions. Produce baseline_progress (one per organisation, objective, selected assessment, operator, revision) and immutable baseline_snapshots (unique request id, versioned payload, source ids and timestamps, saved by/at). Preserve leadership_report_snapshots existing payload schema/readers. New baseline UI links existing readiness report; does not replace it.

- [x] Write failing tests for save/resume, partial scope/unanswered questions, stale draft revision, repeat identical save, cross-tenant assessment references, immutable historic scope and summary, membership denial, and changes comparison only for matching scope/assessment basis.
- [x] Implement operator-only draft/save functions with authorisation and atomic consistent reads; collect snapshot inputs from actual database records, never accept client-computed readiness claims. Members can read saved baseline; edits remain coordinator-only. Unanswered/missing/expired evidence are limitations. Keep human-review and live-provider proof explicitly distinct.
- [x] Render resumable objective/assessment selection with links to existing scope/assessment/task screens, save partial baseline action, dated immutable summary and source drill-down. Show missing owners/dates, pending reviews, open/overdue work, evidence limitations and comparable changes from previous snapshot. No invented compliance percentage or inferred verified resolution.
- [x] Run focused unit/database tests, lint and typecheck; self-review and commit. Controller reviews and pushes verified work.

### Task 3: Local demonstration and owner-facing evidence

**Files:** create e2e/team-baseline.spec.ts and local guarded fixture/preview helper under scripts if needed. Update docs/release-checklist.md and add docs/evidence/2026-09-09-team-baseline.md containing sanitised results and screenshot links only.

**Interfaces:** Consume Tasks 1 and 2 via supported UI and authenticated RPC; service key allowed solely in local fictional fixture setup, guarded by localhost and isolated port. App preview on 3200 uses isolated database, provider credentials disabled.

- [x] Demonstrate two assignees, submission, change request/resubmission, independent coordinator acceptance and leadership baseline reading. Test denied unrelated/reassigned submission. Save a partial baseline, resume, create successor after review and retain original content. Confirm task completion does not claim verified resolution.
- [x] Capture desktop/mobile screenshots, fresh backend permission test output, source identity and test environment. Never commit credentials, raw database outputs or private operational artifacts.
- [x] Run full application checks and production build; run targeted browser acceptance against that build. Review full branch, address important issues and retest affected behavior.
- [x] Commit/push evidence and status. Open the tested preview for Mukta. State what is implemented, automatically verified, demonstrated with fictional data, and still awaiting Charlie/live-provider/hosted acceptance.

Completion evidence is recorded in [the connected-baseline report](../../evidence/2026-09-09-team-baseline.md) and the existing release checklist. This is a fictional local production milestone; intended-team, live-provider and hosted acceptance remain separate. The known pre-existing SoA style-test failure is preserved.
