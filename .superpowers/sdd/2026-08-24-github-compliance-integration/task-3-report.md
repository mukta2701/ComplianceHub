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
