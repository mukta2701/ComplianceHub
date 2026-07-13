# Auditor Access Log Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Log successful auditor-token resolutions and expose a bounded, owner-only recent-view history.

**Architecture:** Add an append-only org-scoped table protected by owner-readable RLS and write it only inside the existing token-gated security-definer RPC after successful token resolution. Read a safe, audit-filtered, ten-row projection on the existing owner audit detail page.

**Tech Stack:** PostgreSQL/Supabase RLS and RPC, pgTAP, Next.js server components, TypeScript, Vitest.

---

### Task 1: Database contract and security tests

**Files:**
- Create: `supabase/tests/database/040_auditor_access_log.sql`
- Create: `supabase/migrations/20260713005956_auditor_access_log.sql`

1. Write pgTAP assertions for owner read, same-org member and cross-tenant denial, direct anon/authenticated insert denial, successful RPC exact-token logging, and invalid/expired/revoked no-log behaviour.
2. Run the focused pgTAP file against the current local schema and confirm it fails because `public.auditor_access_log` does not exist.
3. Run `npx supabase migration new auditor_access_log`.
4. Implement the idempotent table, restrictive token FK, constraints/index, owner-only `SELECT` policy, narrow grants, generic-trigger cleanup, and `audit_view_for_token` replacement whose post-resolution insert precedes the unchanged payload construction.
5. Apply SQL locally only with `docker exec -i supabase_db_compliancehub psql` and rerun focused pgTAP until green.

### Task 2: Owner-facing bounded history

**Files:**
- Modify: `src/app/app/audits/[id]/page.tsx`
- Test where feasible: focused TypeScript/Vitest rendering or projection test

1. Add a failing focused test for the bounded safe recent-view projection if a practical local unit seam exists; otherwise rely on pgTAP plus runtime UI verification for this server-component query/render.
2. Query at most ten audit-log rows through an inner token relationship filtered by the displayed audit id, select only `viewed_at` plus token `label`, and surface query errors explicitly.
3. Render a compact “Recent auditor views” list beside the existing share-link management area with an empty state.
4. Run focused TypeScript/Vitest checks.

### Task 3: End-to-end verification and commit

1. Run the full pgTAP database suite.
2. Start the app locally and use an owner session to mint an auditor link, open it logged out, then confirm the owner sees the matching recent view; inspect browser console and server logs.
3. Run `npm run verify` and review the complete output.
4. Inspect `git diff` and staged changes for scope, unrelated edits, and secrets.
5. Commit with `git commit --no-verify` only when every gate is green; do not merge or push.
