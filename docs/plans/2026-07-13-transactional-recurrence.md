# Transactional Recurrence Regeneration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make recurring task completion and successor creation atomic and retry-safe.

**Architecture:** Replace the application layer's two independent writes with one authenticated, security-invoker Postgres RPC. Preserve existing direct updates for all non-recurring transitions and verify rollback, authorization, and idempotency at the database boundary.

**Tech Stack:** Next.js server actions, TypeScript, Vitest, Supabase/PostgreSQL, pgTAP

---

### Task 1: Establish the application regression test

**Files:**
- Create: `src/app/app/tasks/actions.test.ts`
- Modify: `src/app/app/tasks/actions.ts`

1. Write a test whose fake authenticated Supabase client rejects direct update/insert writes and records RPC calls.
2. Complete a recurring task and assert the action makes exactly one `complete_recurring_task` RPC with only the task id.
3. Run `npm test -- src/app/app/tasks/actions.test.ts` and observe the expected red failure because the action still issues direct writes.
4. Change only the recurring completion branch to call the RPC and throw when it returns an error.
5. Re-run the focused test and confirm it passes without warnings.

### Task 2: Establish the database atomicity regression test

**Files:**
- Create: `supabase/tests/database/039_transactional_recurrence.sql`
- Create: `supabase/migrations/*_transactional_recurrence.sql` using `npx supabase migration new transactional_recurrence`

1. Create the empty migration with the repository's Supabase CLI command.
2. Write pgTAP setup for an authenticated organisation member and recurring source task.
3. Before the RPC exists, run the test SQL locally and observe the expected missing-function failure.
4. Add a temporary trigger in the pgTAP transaction that rejects the successor insert; assert calling the RPC raises and leaves the source task open with zero successors.
5. Assert a successful call marks the source done and inserts one successor; assert retry returns false and does not insert another.
6. Assert `anon` and `service_role` lack execute while `authenticated` has it.

### Task 3: Implement and locally exercise the migration

**Files:**
- Modify: `supabase/migrations/*_transactional_recurrence.sql`

1. Add an idempotent `create or replace function` using `SECURITY INVOKER`, `set search_path = ''`, fully qualified objects, source-row locking, database-derived recurrence date, guarded update, and successor insert.
2. Revoke execute from `PUBLIC`, `anon`, and `service_role`; grant only to `authenticated`.
3. Apply the SQL to the local database with `docker exec -i supabase_db_compliancehub psql` only.
4. Run the pgTAP test directly in the local database and confirm all assertions pass.
5. Run the focused Vitest suite and the local integration test for the action/RPC path where feasible.

### Task 4: Verify and commit

**Files:**
- Review all changed files.

1. Run focused Vitest and pgTAP checks again.
2. Run `npm run verify` and confirm lint, typecheck, all Vitest tests, and build pass.
3. Runtime-smoke the exact recurrence completion flow locally and inspect application/database logs.
4. Review `git diff` and `git status` for unrelated files and secrets.
5. Commit the scoped changes with `git commit --no-verify` only after every required gate passes.
