# Demo readiness audit

**Goal:** Audit and repair the current MVP category by category, then verify the complete demo on desktop and mobile.

**Baseline:** `codex/compliancehub-internal-tool` at `dcded8801bd57657702bd91f91b5306004b673c4`, imported with identical commit/tree hashes into the normal repository. The previous root was the July application and is not the demo baseline. Local schema ends at `20260904023147`, matching this source.

**Recovery:** `/Users/m1ghty/~ My Files/02 - Personal/ComplianceHub-recovery-20260904-210225` contains verified bundles, tracked patches, untracked archives, inventories, and checksums for the primary and canonical repositories. Other checkouts remain intact. Canonical untracked source, tests, plans and evidence were copied without replacing differing files; alternate pnpm configuration remains preserved in the source/recovery archive.

## Categories and acceptance

- [x] Establish canonical source and recoverability; install exact lockfile.
- [x] Verify local runtime health and matching database schema.
- [x] Access: Members can read every permitted module; operator controls and authoring routes respect roles; selected-workspace boundaries hold.
- [x] Core workflows: assessment → SoA; risk/asset maintenance; task ownership/dates; evidence lifecycle; treatment completion/reopen.
- [x] Automation/integrations: deterministic sandbox loop, official GitHub state/provenance, paused/revoked behavior, safe retries and transaction boundaries.
- [x] Reporting/sharing: truthful exports and errors, correct snapshot data, auditor links, policies, KPIs, leadership report, framework coverage, Trust Center.
- [x] UX/accessibility: empty/error/loading states, keyboard access, responsive layouts, complete desktop/mobile journeys.
- [x] Cleanup: remove proven obsolete code/dependencies without removing runtime peers or intended unfinished work; tidy active verification configuration.
- [x] Final verification: lint, typecheck, unit/integration/database tests, production build, browser E2E, demo rehearsal and documented limitations.

## Fresh baseline evidence

- Exact lockfile install succeeded. npm reported 3 dependency advisories; investigate during cleanup/security review.
- Lint/typecheck passed; 240 test files, 2,053 passed and 2 skipped before transferring the additional canonical repeatability test.
- Database: 90 files, 1,888 assertions passed.
- `/api/health` returned HTTP 200, `status: ok`, `db: ok` on canonical port 3100.
- Initial root browser run could not launch due to missing Chromium; installed the required Playwright browser before rerunning against canonical source.

## Active access repair

Existing RLS deliberately makes ordinary Members read-only. Several pages nevertheless render mutation controls. Repair the UI and direct authoring routes while preserving owner/admin behavior and database authorization. Add negative Member tests and positive operator tests before implementation. Assessment and SoA retain their navigable review interfaces with read-only fields.

The canonical request policy further restricts Members to their overview, policies, framework coverage, monitoring, notifications and published leadership reports. Preserve this reduced portal. Core register page-level read-only guards provide additional protection; browser verification must assert the existing redirects for operator-only routes, not expand Member access.

## Known follow-up findings

Validate against the current source before fixing: missing risk/task edit flows; RTP reopen retaining completion date; multi-write RTP/finding task creation; export query errors yielding empty successful workbooks; closed risks included in an “open” heatmap. Historical branch findings already repaired in the canonical source are excluded.

## Current repair evidence

- User confirmed inclusion of unfinished development branches. See `2026-09-04-unfinished-branch-reconciliation.md`; extract missing capabilities into the current product, preserving newer controls and interfaces.
- Member UI and direct-route restrictions implemented across core registers, assessment, SoA, audits, KPIs and evidence. Focused application verification passed; final E2E read-only journey remains pending.
- Risk and task edit flows implemented with workspace/role checks and metadata preservation. Closed risks no longer contribute to the open-risk heatmap.
- RTP lifecycle clears actual completion when reopened; repeat completion preserves its date. Core risk/RTP action tests: 19 passed.
- New treatment/finding transaction migration: 14 pgTAP assertions passed in a rolled-back proof, including failed-task rollback. Application actions are being connected before local migration apply.
- Assessment completion validates complete answer coverage, revision, role and workspace. Completion UI/API verification: 40 tests passed; 17 pgTAP assertions passed in a rolled-back proof. Creation-state guard is being added.
- Baseline browser suite: 49 passed / 9 failed. Failures include obsolete integration labels, unapproved synthetic Slack destination, and three desktop navigation/action timing failures; investigate and rerun affected journeys before final suite.
- Both core migrations applied locally and recorded in migration history. Full database suite now passes: 92 files / 1,921 assertions. `supabase db lint` reports no schema errors in public or assessment_private.
- Independent core review identified and verified fixes for assessment answer-reversion races, task option-query failures clearing links, and Member audit/finding status visibility. Follow-up: 6 files / 51 tests passed.
- Assessment queue now preserves rapid A→B→A edits and completion reconciles every draft, blocking on failed/conflicting saves. 45 scoped assessment tests passed before optional assistance restoration.
- Browser rehearsal in synthetic workspace: created and edited owned risk, verified residual score changes, created treatment + owned/dated task atomically, edited task date/recurrence while retaining source and risk link, and inspected missing-setup audit preflight.
- Restored manual-first onboarding: seven core steps and optional integrations card. Restored audit preflight and task/evidence AI entry points from unfinished branches. Assessment/SoA optional assistance restoration and related E2E are in progress.
- Core category final verification: 264 application test files, 2,242 passed / 3 skipped; lint and typecheck passed. Sixteen targeted desktop/mobile journeys passed across new maintenance/completion tests and existing onboarding, assets, RTP, audit, SoA and Member-portal tests. Final assessment assistance recovery regressions passed before this full suite.
- Legacy CEO fixture compatibility remains assigned to final demo setup: its completed session has only 3 of 10 catalogue answers, and its fresh insert is correctly rejected by the new draft-only guard. Preserve the frozen fixture; prepare a valid fresh showcase through complete answer coverage.

## Active automation/integration category

Repair stale sandbox browser assertions and approved synthetic Slack destination setup; verify official GitHub collection/provenance; selectively port native Jira with forward migrations and current broker coexistence; validate lifecycle, worker, retries and safe summaries. Native design and provider documentation are in the unfinished-branch reconciliation ledger. No live provider credentials are currently configured locally; use clearly labelled sandbox showcase data while awaiting the optional live-provider preference.

Hosted schema reconciliation was applied through the Supabase management query path and verified with linked migration history; no database reset or blanket historical branch merge was performed.

Final evidence: `npm run verify` passes (281 test files, 2,384 passed, 3 skipped, production build); `npm run test:db` passes (93 files, 1,925 assertions); hosted browser coverage passes 60/60 with the local-only GitHub shadow journey passing on Chromium and mobile, plus the targeted Phase 1 rehearsal passing 2/2.

The completed standard security scan reported two low-severity resource-exhaustion findings. The observability finding is fixed in the current worktree with a global limiter and regression test. Public auditor-link rate limits, bounded snapshots or pagination, and access-log retention remain pre-launch hardening work; tenant isolation, OAuth binding, webhook verification, export safety, and credential boundaries had no confirmed findings. TAC access was unavailable during the scan.
