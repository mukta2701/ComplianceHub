# Task 3 report: post-terminal GitHub materialiser

## Status

Implemented the shared, idempotent post-terminal materialisation service and connected it after the dedicated scheduled, webhook, and manual GitHub collection orchestrators. The generic daily cron performs only a bounded 20-run recovery sweep. `runGitHubCollection` and `buildCollectionDependencies` remain phase-1-only.

## Public application API

`src/features/github/application/materialise-approved-observations.ts` exports:

- `buildMaterialisationDependencies(service)` — the service-role Supabase boundary. It lists only completed `succeeded`/`partial` runs, loads the active non-revoked sealed mapping approval, selects bounded observation columns, and calls only `materialise_github_observations_server`.
- `materialiseApprovedGitHubObservations(deps, { organisationId, collectionRunId })` — validates one terminal run, approval, and every observation; selects Task 1 treatments; sends deterministic exact-five-key decisions; and returns a safe bounded outcome.
- `reconcileApprovedGitHubObservations(deps, scope)` — a capped deterministic batch wrapper used by all scheduled/manual/webhook/recovery orchestrators.
- `MaterialisationOutcome` statuses: `awaiting_approval`, `not_terminal`, `stale_approval`, `invalid_data`, `permission_denied`, `retryable_failure`, `materialised`, and `unchanged`.
- `ReconciliationSummary` fields: `runsConsidered`, `materialised`, `unchanged`, `awaitingApproval`, and `needsAttention`.

The Task 2 RPC invocation has exactly these arguments and no actor argument:

```text
materialise_github_observations_server(
  target_organisation_id,
  target_collection_run_id,
  target_mapping_version,
  target_mapping_checksum,
  target_decisions
)
```

Every decision has exactly `observation_id`, `treatment_kind`, `iso_control_references`, `failure_severity`, and `remediation`. Observation titles, explanations, provider remediation text, fingerprints, URLs, diagnostics, and raw provider bodies are not sent to the RPC or returned in summaries.

## Orchestration behavior

- `POST /api/cron/github-collect` drains webhooks, completes scheduled collection, then runs a capped 100-run materialisation reconciliation. Materialisation exceptions return HTTP 200 with the unchanged collection summary, a bounded failure summary, and `collectionHealth: "needs_attention"`.
- The webhook worker reconciles the resolved installation/repository only after a valid collection summary. A materialisation attention outcome finalises the delivery as retryable `failed/internal_error`; a completed-duplicate collection can therefore retry materialisation without recollecting.
- The manual installation recheck reconciles only the active organisation/installation after collection. Its result preserves the terminal collection summary and separately exposes materialisation or awaiting-approval state.
- The generic daily cron calls the same service with `{ limit: 20 }` as an isolated recovery stage. It does not collect GitHub or duplicate materialisation logic.
- `runGitHubCollection` has no evidence, finding, Slack, or materialisation dependency. The existing isolation test now explicitly guards the materialisation boundary too.

## RED evidence

1. `npm test -- --run src/features/github/application/materialise-approved-observations.test.ts`
   - RED: suite could not resolve the missing materialiser module.
2. The same command after the pure API existed.
   - RED: two builder tests failed because `buildMaterialisationDependencies` did not exist.
3. `npm test -- --run src/app/api/cron/github-collect/route.test.ts`
   - RED: three tests failed because scheduled collection did not invoke or expose materialisation.
4. `npm test -- --run src/features/github/application/webhook-worker.test.ts`
   - RED: two tests failed because the worker did not reconcile and did not keep materialisation failures retryable.
5. `npm test -- --run src/app/app/integrations/actions.test.ts`
   - RED: two tests failed because manual recheck did not reconcile or expose attention.
6. `npm test -- --run src/app/api/cron/daily/route.test.ts`
   - RED: two tests failed because no bounded recovery stage existed.
7. `npm test -- --run src/features/github/application/materialise-approved-observations.test.ts src/app/api/cron/github-collect/route.test.ts src/app/app/integrations/actions.test.ts`
   - RED: three tests failed before candidate ordering changed to newest-first and clock-dependent `completedAfter` orchestration filters were removed.

## GREEN and verification evidence

- Focused materialiser: 14 tests passed.
- Focused affected suite:
  - `npm test -- --run src/features/github/application/materialise-approved-observations.test.ts src/features/github/application/collection-deps.test.ts src/features/github/application/run-collection.test.ts src/features/github/application/webhook-worker.test.ts src/app/api/cron/github-collect/route.test.ts src/app/api/cron/daily/route.test.ts src/app/app/integrations/actions.test.ts`
  - 7 files passed; 103 tests passed.
- Full unit suite:
  - `npm test -- --reporter=dot --silent`
  - 212 files passed; 1,508 tests passed; exit 0.
- `npm run typecheck` passed.
- Focused ESLint across all touched TypeScript files passed with no findings.
- `git diff --check` passed.
- Task 2 migration preservation:
  - working-tree hash: `8061fa4cb2c292c73099ef7c0e1ccf8a5aaadded`
  - `HEAD` hash: `8061fa4cb2c292c73099ef7c0e1ccf8a5aaadded`
  - no diff in `supabase/migrations/20260824184628_github_compliance_materialisation.sql`.

The first typecheck exposed implicit callback types in the promise-like test double. Root-cause comparison with the existing typed `Query` test double led to one explicit generic `then` signature; the subsequent typecheck passed.

## Files

Created:

- `src/features/github/application/materialise-approved-observations.ts`
- `src/features/github/application/materialise-approved-observations.test.ts`
- `.superpowers/sdd/2026-08-24-github-compliance-integration/task-3-report.md`

Modified:

- `src/features/github/application/webhook-worker.ts`
- `src/features/github/application/webhook-worker.test.ts`
- `src/features/github/application/collection-deps.test.ts`
- `src/app/api/cron/github-collect/route.ts`
- `src/app/api/cron/github-collect/route.test.ts`
- `src/app/api/cron/daily/route.ts`
- `src/app/api/cron/daily/route.test.ts`
- `src/app/api/cron/daily/route.integration.test.ts`
- `src/app/app/integrations/actions.ts`
- `src/app/app/integrations/actions.test.ts`

## Commit

- `feat(github): reconcile approved compliance results` (the implementation and this report are committed together; final SHA is supplied in the task handoff).

## Concerns and follow-up

- The live daily-cron integration test could not run in this sandbox. `npx supabase status` could not access the Colima Docker socket, and the integration command reported that this worktree lacks `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the disposable localhost stack. The modified integration assertion is therefore not claimed as executed here.
- Recovery sweeps deliberately prioritize the newest completed runs and remain capped. The RPC supplies concurrency/idempotency; old runs that continuously return `awaiting_approval` do not block newer terminal runs.
- No external services were called, and nothing was pushed, merged, or deployed.

---

## Review fix round 1 (2026-08-24)

### Status and corrected design

The starvation and validation blockers are fixed. This section supersedes the
earlier report statements that recovery sampled newest terminal runs.

- `runGitHubCollection` remains phase-1-only but now returns safe exact
  `terminalRuns` references for every newly finalised `succeeded`/`partial` run
  and every completed duplicate in either status. Failed, active-duplicate,
  malformed, and lost-lease outcomes do not create references.
- Scheduled, manual, and webhook orchestration pass those exact references to
  the shared reconciler. Exact sets are processed in deterministic chunks of
  100, so a collection spanning more than 100 repositories is not truncated.
- The daily cron remains only a bounded `{ limit: 20 }` recovery claim. It no
  longer scans or samples terminal collection runs.
- Successor migration
  `20260824212223_github_materialisation_jobs.sql` creates exactly one durable
  job per terminal succeeded/partial run. An insert/update trigger enqueues in
  the collection-finalisation transaction and the migration backfills existing
  eligible runs idempotently.
- Queue states are `pending`, `awaiting_approval`, `retryable`, and `completed`.
  Claims use five-minute CAS leases, a 25-attempt ceiling, bounded exponential
  backoff, `FOR UPDATE SKIP LOCKED`, and per-tenant age ranking. Completed work
  is never reclaimed. Generic recovery leaves awaiting-approval work parked;
  exact primary reconciliation can report it, and a new active approval wakes
  it to `pending`.
- Queue reads are tenant-scoped by RLS. Direct mutation grants are absent.
  Claim/finalise RPCs are security-definer, empty-search-path, service-only
  boundaries.

### Strict materialiser contract

The application now requires a terminal run with `observation_count = 15` and
exactly the 15 literal `EXPECTED_GITHUB_CHECK_IDS`. It loads and validates the
organisation, installation, local repository, provider repository, run, and
repository identity ancestry before calling Task 2. Every observation must
have the canonical run ancestry, rule version, key, subject, and GitHub source
URL. Pass/fail/unknown/not-applicable severity, diagnostic, and remediation
semantics are checked, including exact mapped fail severity/remediation and the
canonical unknown remediation. Missing, duplicate, unknown, cross-ancestry,
or malformed rows return `invalid_data` with no materialisation RPC.

The Task 2 RPC remains unchanged and service-only:

```text
materialise_github_observations_server(
  target_organisation_id,
  target_collection_run_id,
  target_mapping_version,
  target_mapping_checksum,
  target_decisions
)
```

Decisions remain deterministically ordered and contain exactly the five keys
`observation_id`, `treatment_kind`, `iso_control_references`,
`failure_severity`, and `remediation`. Behavioural repeat and simultaneous-call
tests prove that both callers delegate the same bounded decisions to the atomic
Task 2 boundary; no raw provider response is passed or returned.

### RED evidence

1. Collector summary tests: four failures because terminal references were
   absent for succeeded/partial finalisations and completed duplicates.
2. Strict 15-check fixture: eight failures because the previous run schema did
   not load repository ancestry and accepted only count-based validation.
3. Queue application boundary: three failures because `claimJobs` and
   lease-matched `finaliseJob` did not exist and reconciliation still sampled
   collection runs.
4. Canonical unknown remediation: one failure because an arbitrary non-null
   value was accepted.
5. Explicit repository-FK loader: one failure because the PostgREST join did
   not name the composite ancestry constraint.
6. Deployment contract: one failure while the workflow still required
   `20260824184628` rather than the new latest migration.

### GREEN and verification evidence

- Focused affected suite: 7 files passed; 134 tests passed.
- Final full unit suite: 212 files passed; 1,539 tests passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `actionlint .github/workflows/*.yml`: passed.
- `git diff --check`: passed.
- Deployment contract: 8 tests passed.
- Task 2 migration preservation: working tree and `HEAD` SHA-256 are both
  `e3a6e16c191cb42c3637f876c1899b130d996f9f2e23fb8cb2495cafe9c36c0d`;
  the file has no diff.

Database runtime verification was attempted with:

```text
SUPABASE_TELEMETRY_DISABLED=1 npx supabase db reset
SUPABASE_TELEMETRY_DISABLED=1 npx supabase test db supabase/tests/database/071_github_materialisation_jobs.sql
```

The sandbox denied access to
`/Users/m1ghty/.colima/default/docker.sock`, so reset/pgTAP could not execute.
The new `071_github_materialisation_jobs.sql` suite remains strict and covers
transactional enqueue/replay, failed-run exclusion, cross-tenant fairness,
active-lease concurrency exclusion, lease recovery, stale finalisation,
completed non-reclaim, awaiting-approval wake-up, backoff, attempt bounds,
RLS, grants, and service-only RPCs.

### Files changed in this round

Created:

- `supabase/migrations/20260824212223_github_materialisation_jobs.sql`
- `supabase/tests/database/071_github_materialisation_jobs.sql`

Modified:

- `src/features/github/application/run-collection.ts` and tests
- `src/features/github/application/materialise-approved-observations.ts` and tests
- `src/features/github/application/webhook-worker.ts` and tests
- `src/app/api/cron/github-collect/route.ts` and tests
- `src/app/app/integrations/actions.ts` and tests
- `src/features/github/components/github-installation-panel.test.tsx`
- `.github/workflows/deploy-azure-staging.yml`
- `src/features/mcp/azure-deployment-contract.test.ts`
- `docs/deployment.md`, `docs/deployment/github-shadow-pilot.md`, and
  `docs/release-checklist.md`

### Deployment and concerns

The deployment gate and unchecked operator documents now require exactly 16
pending migrations through `20260824212223`. No hosted application, migration,
backup, or deployment is claimed. No external service was mutated, and nothing
was pushed, merged, or deployed. The only outstanding runtime concern is the
sandbox-blocked Docker/pgTAP execution described above.

The review-fix implementation and this appended report are committed together;
the final SHA is supplied in the task handoff.
