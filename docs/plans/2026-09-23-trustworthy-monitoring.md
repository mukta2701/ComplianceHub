# Milestone 2 trustworthy Monitoring implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn observations from Owner-selected GitHub repositories into approved, traceable compliance results with narrow daily collection, safe alerts and built-in AI mapping proposals.

**Architecture:** Extend the existing GitHub rule, mapping, materialisation and Monitoring modules. Keep the rule evaluator deterministic; store per-entry Owner decisions and AI proposals separately; use one bounded collector for daily and authorised manual work. Publish accepted mapping changes as immutable, versioned packs; make the database materialiser and official readers understand exact entry decisions while retaining legacy pack approval ancestry. Preserve old pack approvals and official records.

**Tech Stack:** Next.js 16.3, TypeScript, React, Supabase PostgreSQL/RLS, pgTAP, Vitest, Playwright, GitHub App read APIs, GitHub Actions, AWS dev App Runner/ECR, Slack incoming webhooks.

**Approved design:** [Milestone 2 trustworthy Monitoring design](2026-09-23-trustworthy-monitoring-design.md).

---

## Working rules

- Read the current [release checklist](../release-checklist.md) before making a completion claim. Milestone 1 is an AWS dev candidate, not accepted. Local Milestone 2 development may proceed; hosted acceptance waits for an approved, stable Milestone 1 selected-repository scope and an authorised integration checkpoint. Do not merge or deploy just because this plan exists.
- Keep one writer per overlapping code or schema area. Apply `@superpowers:test-driven-development`, `@supabase:supabase` for database work, `@codebase-design` for interface changes, `@domain-modeling` for terminology, and `@design-taste-frontend` for product UI. Read the installed Next.js 16.3 guide under `node_modules/next/dist/docs/` before application code changes.
- Run heavy checks sequentially with `node --import=tsx scripts/local-resource-guard.ts -- <command>` and follow `docs/local-resource-guard.md`. Preserve existing database volumes and unrelated worktree changes.
- Make additive migrations with `supabase migration new <name>` after checking the installed CLI help. Preserve applied migrations, existing approval receipts and official records. Review Supabase's current documentation and security checklist before schema implementation.
- Keep the first live pilot to the one approved AdTecher repository. Design all repository loops for every Owner-selected repository, never every repository merely visible to the App. No GitHub write request, scope change or real failure-inducing change is part of this plan.
- No new AI vendor, metered API route or provider data transfer is authorised by this design. Inspect approved provider eligibility, terms and cost first. If unavailable, continue deterministic work and report the live AI acceptance gate as open.
- A product UI pull request needs a real before/after interaction GIF and desktop/mobile screenshots, fresh specialist Taste V2 review, independent technical review, and tests. Do not claim a pass when the required specialist or evidence is unavailable.

## Phase 1: Record the baseline and protect historical data

### Task 1: Baseline audit and acceptance fixtures

**Files:** `docs/evidence/<dated>-m2-baseline.md` (create at execution time), `src/features/github/domain/rules.test.ts`, `src/features/github/domain/mapping.test.ts`, `src/features/github/application/materialise-approved-observations.test.ts`, `supabase/tests/database/070_github_compliance_materialisation.sql`, `e2e/github-connection-milestone.spec.ts` after Milestone 1 integration.

1. Record the implementation base SHA, active branch, current migration ledger, available local fictional accounts and existing UI screenshots before editing. Identify any retained active whole-pack approvals without logging private records.
2. Run the focused rule, mapping and materialisation tests and the current database contract under the resource guard. Record exit codes and intentional skips. Do not treat a green historical test as live acceptance.
3. Write an acceptance fixture covering two selected repositories in separate workspaces, one out-of-scope repository, all four outcomes, a changed mapping, stale data, duplicate collection and a newer Pass after Failure. Keep provider-shaped data fictional.
4. Commit only the baseline evidence and fixture contract. Stop if current migrations or selected-scope identity do not match the intended source; resolve that mismatch before a hosted test.

## Phase 2: Individual mapping review and official results

### Task 2: Add entry-level approval history without losing pack history

**Files:** generate `supabase/migrations/<generated>_github_mapping_entry_decisions.sql`; create `supabase/tests/database/110_github_mapping_entry_decisions.sql`; modify `src/features/github/application/github-mapping-review.ts` and its test.

1. Write pgTAP tests first. An Owner can approve or reject an exact mapping entry and version; Admin/Member and another workspace cannot. A changed entry needs new approval, while unchanged entries retain theirs. An approved old whole-pack receipt maps to its exact historical entries without changing those receipts or official result provenance. A later version gets no implicit approval.
2. Run `npm run test:db` under the resource guard and confirm the new assertions fail for the missing contract, not an unrelated local database problem.
3. Add an append-only decision table and narrowly authorised read/write functions or policies. Check grants, RLS, server actor identity, entry version/checksum matching, uniqueness and historical backfill. Treat an old pack approval as approval of only its exact historical entry digests; do not give a changed entry implicit approval. Do not relax the existing immutable pack or provenance guards.
4. Run the database upgrade rehearsal and pgTAP suite. Confirm the retained schema and historical records still read. Update the review loader to return each entry's pending/approved/rejected state, reviewer, version and change reason, then run its focused unit test.
5. Commit the schema, database tests and loader as one reviewable change. Apply to AWS dev only after a separate dry run identifies the exact unapplied migration.

### Task 3: Make materialisation respect each exact approval

**Files:** `src/features/github/application/materialise-approved-observations.ts`, its test, `src/features/github/domain/mapping.ts`, its test, `supabase/tests/database/070_github_compliance_materialisation.sql`, `supabase/migrations/20260901131747_github_official_monitoring_reads.sql` (read-only reference), and a required additive migration generated with `supabase migration new github_entry_materialisation` plus its pgTAP contract test.

1. Write failing application and pgTAP cases for approved, rejected, unreviewed and superseded entries in one collection run, including zero approved entries and two repositories. Only an exact approved entry may produce official records. An unapproved entry remains a visible technical observation without a positive compliance claim.
2. Test the existing Pass-to-Evidence, Failure-to-one-Finding, conditional Task, Unknown/Not applicable, newer-Pass resolution and duplicate-run paths against entry-level decisions. Task completion must not close the Finding.
3. Migrate the SQL materialiser, not only its TypeScript caller: it currently requires an active whole-pack approval and one decision per observation. Accept decisions for exactly the approved entries in a run, reject decisions for unapproved entries, and make an all-unapproved run a safe no-op. Validate the selected immutable pack and exact entry digest server-side. Do not bypass completeness or workspace checks for approved entries.
4. Extend Evidence/Finding/transition provenance and the official read RPCs with entry-decision ancestry and currentness. Keep legacy whole-pack foreign keys and receipts readable without fabricating new decisions; new writes must point to an actual current entry decision. A changed or revoked entry cannot appear current merely because an old pack approval is active. Replace direct Member reads of historical whole-pack approval rows only after Member-safe official reads no longer depend on them. Test Member denial on that table while preserving the Member's approved-result summary, plus old records, mixed decisions, revocation and cross-workspace reads after upgrade.
5. Run focused unit, pgTAP and upgrade tests to green; commit the behavior and tests. Do not recalculate old records under a new mapping.

### Task 4: Present the review and role-specific results

**Files:** `src/features/github/components/github-compliance-control-room.tsx`, `src/app/app/monitoring/github-control-room-actions.ts`, `src/app/app/monitoring/page.tsx`, `src/features/monitoring/application/load-member-monitoring.ts`, their focused tests, and the workspace-access policy/tests if a new operation is needed.

1. Capture the pre-change Monitoring review in a production-mode local preview with fictional data. Write failing component/action tests for one-screen per-entry approve/reject, changed-version prompts, Owner-only decisions, Admin recheck access and Member read-only summaries. Test direct action calls, not only hidden controls.
2. Add the smallest review UI and server actions. Show the approved result, source date and next action first; place version/provenance detail nearby. Keep the existing dashboard and visual language.
3. Change the manual GitHub recheck authorization from Owner-only to Owner/Admin without granting either role new repository-scope controls. Enforce the role in both UI/action and relevant database calls.
4. Run focused unit/access tests, then a fictional Owner/Admin/Member browser journey at desktop and mobile sizes. Commit the UI and role change with its evidence. Arrange independent technical and specialist visual review before a product-quality claim.

## Phase 3: Narrow daily operation, alerts and exceptions

### Task 5: Run selected-repository collection daily

**Files:** `src/features/github/application/run-collection.ts`, `src/app/api/cron/github-collect/route.ts` and their tests; after Milestone 1 integration, `scripts/build-runtime-bundles.ts`, a finite `scripts/github-compliance-collect.ts` plus tests, `.github/workflows/collect-github-compliance-aws-dev.yml` plus static workflow tests.

1. Write failing tests for one daily occurrence per selected repository, two repositories with one failure, lease recovery, bounded batch size, revoked access, missed schedule and no cross-workspace or out-of-scope work. Keep the 36-hour freshness meaning separate from a failed scheduler run.
2. Reuse the existing collection/materialisation application functions behind one finite command in the immutable AWS dev image. The command logs safe counts, exits on incomplete work, and leaves retryable jobs durable. Keep the existing route compatible until callers are inventoried; do not add a general Automation page or master switch.
3. Add a protected daily workflow on the default branch using the approved image digest and secrets pattern established by Milestone 1. Run workflow-contract tests against wrong registry, tag, missing secret, overlapping run and accidental GitHub write permissions. A manual dispatch is preliminary proof; acceptance requires an actual scheduled event.
4. Run focused unit, database, bundle and container checks sequentially; commit the runner and workflow. Record collection health separately from check results.

### Task 6: Notify on compliance changes, not every poll

**Files:** `src/features/monitoring/application/slack-alert-queue.ts`, `slack-alert-store.ts`, their tests, `src/features/monitoring/application/deliver.ts`, `src/app/app/monitoring/page.tsx`, and an additive delivery migration/test if existing queue keys cannot represent a result lifecycle.

1. Write failing tests for a new Failure, sustained actionable Unknown, stale result, verified recovery, unchanged Pass, duplicate webhook/run and a second failure after verified recovery on the same UTC day. Include clock-advance with no successful collection. A queue row is not confirmed delivery.
2. Add a safe, bounded event builder from official result transitions plus a daily time-based evaluation that runs even when collection fails. Persist the first actionable Unknown time and alert after 36 hours if still Unknown; use the existing 36-hour freshness boundary for stale data. Deduplicate by repository/check incident, prioritising a stale alert over a simultaneous sustained-Unknown alert, and allow a new incident after verified recovery. Route in-app notices to the authorised audience and Slack to the approved private team channel. Each message links to the matching ComplianceHub record and contains no employee DM or Slack action.
3. Keep connection-health delivery and Milestone 1 [issue #28](https://github.com/mukta2701/ComplianceHub/issues/28) separate. Reuse shared transport only where the contracts match; do not close that issue based on Monitoring tests.
4. Test retries, lease expiry, malformed provider text, absent destination and delivery failure without exposing secrets. Commit only after the relevant queue/database and rendering tests pass.

### Task 7: Add expiring Owner exceptions

**Files:** generate `supabase/migrations/<generated>_github_finding_exceptions.sql`; create `supabase/tests/database/111_github_finding_exceptions.sql`; modify `src/app/app/monitoring/github-control-room-actions.ts`, the control-room view and focused tests.

1. Write failing tests for Owner-only approval, required reason, expiry no later than 30 days, renewal as a new decision, expiry returning the Finding to ordinary attention, and another workspace's denial.
2. Store an append-only exception decision tied to the exact Finding, actor and validity window. Keep the underlying outcome `fail`; never create passing Evidence from an exception. Preserve historical decisions after expiry or recovery.
3. Add the review/expiry display and bounded expiry processing to the narrow daily cycle. Run pgTAP, role, domain and browser tests, then commit.

## Phase 4: Built-in AI proposals

### Task 8: Produce one saved proposal per changed mapping input

**Files:** `src/features/github/application/github-mapping-suggestions.ts` and test, `src/features/github/application/github-mapping-review.ts` and test, `src/features/github/application/materialise-approved-observations.ts` and test, `src/features/ai/application/openai-compatible.ts` and test if the existing adapter needs only bounded changes, a generated additive migration, and `supabase/tests/database/112_github_mapping_suggestions.sql`.

1. Before a live call, record the approved provider, account, data terms, available usage and spending boundary. Stop live AI work if no eligible route exists. Do not store or print keys, prompts, repository content or raw responses.
2. Write failing tests for a canonical input containing only check/control descriptions, one job per workspace/check/rule-and-catalogue version, bounded model output, allowlisted control IDs, rationale/confidence, provider timeout and malformed response. A repeated page load must make no provider call.
3. Add a durable pending/proposed/unavailable record with input digest, proposal version, model identity and review metadata. Generate from a bounded background job when the catalogue changes. Treat model text as untrusted and never write approval or official result from this path.
4. Show the saved proposal within the mapping review without an enable switch. Acceptance is an explicit Owner action: validate the proposed control IDs and permitted treatments, publish a new immutable pack version/checksum with the changed entry, and record an entry decision for that exact version. Carry unchanged approvals forward only when their entry digests are identical. The selected version must be loaded by the review screen, TypeScript materialiser and SQL materialiser; do not continue using the compiled seed pack checksum after publication. A proposal that is merely displayed or rejected changes no executable mapping.
5. Permit a manual Owner decision and the same immutable-publication path when AI is unavailable. Test an accepted proposal changing the next official result's mapping ancestry, rejected proposal and old approved mapping continuity; commit only after role, database and upgrade tests pass.

## Phase 5: Integrated acceptance

### Task 9: Prove the complete journey locally and on AWS dev

**Files:** create `docs/evidence/<dated>-m2-monitoring.md`; update `docs/release-checklist.md`; add or extend the current Monitoring browser spec and any focused regression tests.

1. Under the resource guard, run lint, type checking, unit tests, database upgrade, pgTAP, production build, finite-container checks and secret scanning on the integrated candidate. Record exact source, commands, exits and skips.
2. Demonstrate fictional Pass, Failure, Unknown, Not applicable, stale, mapping change, duplicate, exception expiry, AI failure and recovery in a local production preview. Verify HTTP and database health, desktop/mobile layout, keyboard flow and roles. Inspect before/after GIF/screenshots with the required reviewers.
3. With an approved AWS dev candidate, confirm the one selected pilot repository and exact read-only permissions. Run a real read-only observation and inspect the official Evidence/Finding/Task lineage. Do not change GitHub configuration to force a result. Observe one actual daily schedule event and a safe private-channel alert; distinguish queued from delivered.
4. Exercise one real AI suggestion in AWS dev. Confirm it did not alter official state before the Owner's mapping decision, and that the deterministic result did not depend on AI availability. If provider eligibility or cost is unresolved, leave this gate open.
5. Obtain independent technical and specialist product review, then explicit Owner acceptance of the evidence. Update only the existing release checklist and linked evidence. Do not label the pilot production, certification, all-repository rollout or Milestone 3 completion.

## Execution handoff

Implement one task at a time on an isolated feature branch after checking the latest Milestone 1 merge/release state. The writer runs each focused red/green loop, commits and pushes each coherent change under the repository's standing GitHub synchronisation rule, and hands the exact diff and test exits to a fresh reviewer. Pause only at a genuine external boundary: approved AI provider/cost, GitHub App scope, hosted migration, merge/deploy, or human acceptance. This plan authorises none of those changes by itself.
