# Overnight Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Leave `main` verified, runtime-proven, deployable, and documented by completing the highest-priority safe tasks from `docs/codex-overnight-2026-07-13.md`.

**Architecture:** Each queue item is developed on its own `codex/*` branch in an isolated worktree. Tests are written and observed failing before the minimal implementation, and branches are merged sequentially only after the full verification gate and task-specific runtime smoke pass.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Playwright, Supabase/Postgres, pgTAP, Docker, npm.

---

### Task 1: Documentation accuracy

**Files:**
- Modify: `README.md`
- Modify: relevant Markdown files under `docs/`

1. Inspect `src/features/policies/` and `src/app/app/policies/` to establish the shipped policy behavior.
2. Search documentation for policy-template claims and `pnpm` commands.
3. Replace only inaccurate claims and commands, preserving historical source-of-truth documents when appropriate.
4. Run `npm run verify`; expect exit 0.
5. Review the diff for secrets and unrelated edits, commit, fast-forward merge to `main`, push, and remove the branch/worktree.

### Task 2: Zod idiom migration

**Files:**
- Modify: validation schema files returned by `rg -n 'z\.string\(\)\.uuid\(\)' src`
- Test: existing schema/unit tests adjacent to changed files

1. Add or identify schema tests proving valid UUIDs pass and invalid UUIDs fail.
2. Run the focused test and confirm the intended baseline behavior.
3. Replace each exact deprecated idiom with `z.uuid()` without changing refinements or optionality.
4. Run focused tests, then `npm run verify`; expect exit 0 and no new warnings.
5. Runtime-smoke representative form/server-action paths, review, commit, fast-forward merge, push, and clean up.

### Task 3: Transactional recurrence regeneration

**Files:**
- Modify: daily recurrence application/database code discovered from `/api/cron/daily`
- Create: one idempotent migration if an RPC is required
- Create: matching `supabase/tests/database/*` pgTAP coverage for DB/RLS behavior
- Test: focused Vitest coverage for recurrence logic

1. Trace delete-and-insert recurrence flow and document the failure boundary.
2. Write a failing test demonstrating that a mid-operation failure cannot leave partial state.
3. Run it and confirm failure for the missing atomic behavior.
4. Implement the smallest single-transaction RPC or equivalent atomic database operation; keep constants outside `"use server"` modules.
5. Run focused tests, apply migration only to local Docker Postgres when applicable, and exercise the recurrence flow.
6. Run `npm run verify`, inspect logs, review, commit, merge/push only if all gates pass, and clean up.

### Task 4: Auditor access log

**Files:**
- Create: idempotent `supabase/migrations/*_auditor_access_log.sql`
- Create: `supabase/tests/database/*_auditor_access_log.test.sql`
- Modify: auditor token resolution code and owner-facing audits/settings UI
- Test: adjacent Vitest/component tests

1. Write pgTAP expectations for owner-only reads, cross-tenant denial, and controlled insertion.
2. Write a focused failing application/UI test for recording and displaying recent successful views.
3. Implement the org-scoped table, indexes, RLS policies, controlled insert path, and bounded owner query.
4. Apply SQL only to local Docker Postgres and verify access behavior and the successful token flow end to end.
5. Run `npm run verify`; inspect browser/server logs; review secrets and authorization predicates.
6. Commit, merge/push only if all gates pass, and clean up.

### Task 5: Monitoring Realtime toast fallback

**Files:**
- Modify: `src/components/alert-toaster.tsx` (or its actual discovered location)
- Create: minimal browser Supabase client module
- Test: focused fallback/subscription lifecycle test

1. Extract a testable subscription/fallback boundary and write a failing test proving polling remains active when Realtime setup fails.
2. Implement a publishable/anon-key-only browser client using the installed Supabase packages.
3. Subscribe to active-organization `monitoring_findings` inserts, clean up channels on unmount/org change, and retain polling fallback.
4. Run focused tests and `npm run verify`.
5. Start the app, exercise monitoring/toast behavior with Realtime unavailable, and confirm no console/server errors.
6. Review for secret exposure, commit, merge/push only if green, and clean up.

### Task 6: Twilio WhatsApp delivery adapter

**Files:**
- Modify: `src/features/monitoring/application/deliver.ts`
- Create/modify: adjacent monitoring delivery port/adapter modules
- Test: adjacent deterministic delivery tests

1. Mirror the Slack adapter boundary and write a failing test for severity routing, Twilio payload construction, and missing-env no-op behavior.
2. Implement the smallest injectable Twilio HTTP adapter gated by required `TWILIO_*` variables; never call the real API in tests.
3. Keep default behavior deterministic and credential-free, and avoid logging credentials or tokens.
4. Run focused tests and `npm run verify`.
5. Runtime-smoke the fake/no-op delivery path and inspect server logs.
6. Review the diff for secrets, commit, merge/push only if green, and clean up.

### Task 7: Optional lower-priority work

1. Reassess time and main-branch health after T1-T6.
2. Select at most one of T7-T9 from the source document; prefer T9 only if it can be isolated and visually verified safely.
3. Repeat the same TDD, full verify, runtime smoke, review, and sequential merge gate; otherwise record it as skipped.

### Task 8: Final readiness gate and report

**Files:**
- Create/modify: `docs/codex-overnight-notes.md`

1. Confirm `main` matches the intended latest integrated commit and has a clean working tree.
2. Run `npm run verify`; require exit 0.
3. Start `./node_modules/.bin/next dev`, request `GET /api/health`, sign in, and navigate dashboard, risks, SoA, tasks, evidence, monitoring, and settings with Playwright `--workers=1` or the browser.
4. Inspect browser console and server logs; if an offending merge caused errors, revert it and repeat the full gate.
5. Write GO/NO-GO, merged task SHAs, skipped tasks/reasons, blockers, and remaining human deployment steps.
6. Re-run documentation-sensitive checks, commit and push the readiness report, and leave `main` clean.
