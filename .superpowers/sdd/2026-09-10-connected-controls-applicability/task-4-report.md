# Task 4 — Truthful control-review reads

Starting commit: `b62a058`. Worktree: `codex/team-baseline`. Date: 10 September 2026.

## Bounded outcome

The control-review page loads its decisions, assessment provenance, safe ownership labels, evidence, linked work and readiness through `loadControlReview`. Essential read failures display **Could not verify** and suppress finalisation. Optional history/tasks/related-risk failures identify unavailable context and retain the remaining review.

This is implementation and automated fictional-boundary evidence, not a production browser demonstration, provider verification, deployment or human acceptance. No database records, migration files or release checklist were changed. The existing production preview was not rebuilt/restarted by this task.

## Interfaces and behavior

- The loader accepts the authenticated Supabase client and organisation/register IDs. Tenant-owned reads are explicitly scoped to the active organisation; global catalogues are scoped to the register/source assessment versions. It returns source assessment identity, state, revision and catalogue version, every committed mapped question/answer/note/time, explicit null/missing responses, and an empty source-answer array for unmapped controls.
- Missing/blank member names use “Workspace member”; former members use a safe label and an unassigned effective owner. Provider messages and raw removed-member identifiers are not returned as labels.
- All essential list reads request exact counts. Any missing count, query/transport failure, missing essential provenance, hidden evidence record, or incomplete essential result fails closed. The nominal essential-read cap is 5,000 rows; the configured API maximum of 1,000 may lower it, in which case a larger population is explicitly unavailable rather than partially verified.
- History is limited separately to five rows per decision, with exact totals. Displayed task/evidence lists are capped at 20 per decision. Task totals and open-task counts are separately exact. Risks are capped at 50 for each assessment/register relationship, with explicit totals and relationship labels. Per-item optional-list metadata uses `total: null` for unavailable context, never a successful zero. The existing task schema has no human reference column; the loader's task reference is its record ID.
- Date-derived freshness is supplied in `linkedEvidence.status`; the persisted evidence status remains separately available as `storedStatus`. Readiness uses stored current/expiring/expired values and is computed from the full verified evidence population, not its displayed slice.
- Finalisation blockers now match the existing database gate: exactly 93 items; rationale for every item; pending/owner/evidence requirements only for applicable controls; expired stored evidence blocks even beside current evidence. The finalisation action uses these same blockers and reports an incomplete catalogue clearly. Database finalisation remains the authoritative atomic check.
- The page displays current assessment revision, incomplete-assessment limitations, relationship-labelled risks and optional warnings. It makes finalised reviews read-only and labels the source as a current record rather than archived answers.

## RED → GREEN evidence

Commands below were wrapped in `node --import=tsx scripts/local-resource-guard.ts --` and run sequentially, with one Vitest worker.

1. `npm test -- src/features/soa/application/finalisation.test.ts src/features/soa/application/review-queue.test.ts --maxWorkers=1`
   - RED: three failures demonstrated excluded controls wrongly requiring owners/pending resolution and absent catalogue/expired-evidence blockers.
   - GREEN: 31 tests passed after the exact gate/queue changes.
2. `npm test -- src/features/soa/application/load-control-review.test.ts --maxWorkers=1`
   - RED: loader did not exist; then linked evidence/task assertions failed with empty projections.
   - GREEN: exact-version many-to-many provenance and stored-versus-date freshness slices passed.
   - RED: 14 essential/optional failure cases rejected rather than returning truthful availability.
   - GREEN: all failure cases passed after explicit essential/optional handling.
   - RED: three additional cases exposed empty catalogue/membership success and stale member identifiers being treated as valid ownership.
   - GREEN: all 27 loader tests passed, including cross-workspace access, count/cap completeness, 510 busy-control events plus a quiet control, null/missing responses and hidden/cross-workspace evidence.
3. `npm test -- 'src/app/app/soa/[id]/page.test.tsx' --maxWorkers=1`
   - RED: three failures demonstrated absent source identity and thrown essential/optional failures.
   - GREEN: page source context, recoverable failure, optional warning and Member read-only behavior passed using the real loader and a fictional HTTP adapter around the real Supabase client.
4. `npm test -- src/features/soa/application 'src/app/app/soa/[id]' src/app/app/actions.soa.test.ts --maxWorkers=1`
   - First run: 115 passed, two old one-item finalisation success fixtures failed the newly correct 93-item gate.
   - Updated those fixtures to contain all 93 decisions and added a missing-catalogue action assertion.
   - GREEN: 118 tests passed, before the final six loader edge cases were added.
5. Fresh `npm run typecheck` and `npm run lint` passed.

## Full-suite investigation

The complete guarded run finished in 191.76 seconds: **326 files; 325 passed, 1 failed. 2,850 tests passed, 2 failed, 3 skipped.** Both failures were the SoA owner/admin cases in the shared `assessment/[id]/page.ai.test.tsx`.

Following the systematic-debugging skill, I reproduced the same two failures in an isolated run. The page rendered “Could not verify review data.” The hand-built test client lacked the Supabase `returns()` method now used by the typed loader. Adding only that method changed the observed failure to “Could not verify membership,” confirming the boundary diagnosis. The fixture also omitted required member/source-catalogue/revision records. Supplying those fictional records restored all **11/11** shared AI-setting tests without changing the application's failure behavior.

Final affected/focused verification command:

`node --import=tsx scripts/local-resource-guard.ts -- npm test -- src/features/soa/application 'src/app/app/soa/[id]' src/app/app/actions.soa.test.ts 'src/app/app/assessment/[id]/page.ai.test.tsx' --maxWorkers=1`

**9 files / 135 tests passed.** Fresh final typecheck, lint and `git diff --check` passed. The entire suite was not rerun after the fixture-only correction; the complete run and its passing corrective focused rerun are distinct evidence. No resource-guard interruption occurred. Existing jsdom navigation/localstorage warnings were non-failing.

## Self-review and limits

- Compared readiness to `20260901000000_restore_soa_finalisation_evidence_guards.sql`, the approved task brief/specification, and tenant-scoped queries.
- Per-decision context reads run in batches of eight. This bounds concurrency and prevents a global history cap from hiding quieter controls. It remains a series of current reads rather than one database transaction; readiness is advisory and the finalisation RPC rechecks its persisted contract atomically.
- `register` is nullable only in a `could_not_verify` failure result, extending the brief's illustrative success shape to represent failed provenance honestly.
- Selected-control question rendering and per-item list-limit/unavailable labels are inputs for Task 5's workspace presentation. They are supplied in the read model; this task does not claim the pending workspace presentation or browser milestone is complete.
- Independent standards/specification reviews, local production build/browser checks and GitHub push are coordinated by the parent task. This subtask will commit but will not push, as explicitly directed.


## Handoff

- **Changed this session:** Centralized review/provenance/freshness/readiness reads and exact finalisation guidance; updated affected public-boundary tests.
- **Verified:** Fresh 135-test focused pass, final lint/typecheck/diff hygiene; complete-suite outcome and isolated fixture correction recorded above.
- **Still unfinished:** Task 5 presentation, parent-coordinated independent reviews, production build/browser demonstration and GitHub push. Existing preview remains unchanged.
- **Next step:** Consume the loader's source/context/list metadata in the Task 5 workspace and continue the integrated verification workflow.
