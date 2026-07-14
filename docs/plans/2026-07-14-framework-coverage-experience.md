# Framework Coverage Experience Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver an honest, accessible SoA-to-framework coverage page with operator-managed organisation mappings and a read-only Member experience.

**Architecture:** Keep `control_crosswalks` organisation-authored and derive coverage in the existing pure domain module. Add a dedicated authorization capability, guard both actions before mutation, and let the page render one shared presenter model with role-gated controls. Existing RLS remains defense in depth; only tests change at the database layer.

**Tech Stack:** Next.js server components/actions, React Testing Library, Vitest, Zod, Supabase/Postgres RLS, pgTAP.

---

### Task 1: Coverage domain presenter

**Files:**
- Modify: `src/features/controls/domain/crosswalk.ts`
- Modify: `src/features/controls/domain/crosswalk.test.ts`

1. Add failing tests proving a requirement is counted once and every mapping row
   is Covered when any sibling mapping points to a mature ISO control.
2. Run `npx vitest run src/features/controls/domain/crosswalk.test.ts`; expect the
   new presenter export to be missing.
3. Add a pure mapping-annotation function keyed by framework plus external
   reference. Keep `summariseFrameworkCoverage` consistent with the same OR
   semantics.
4. Re-run the focused test; expect all tests to pass.

### Task 2: Explicit capability and action boundary

**Files:**
- Modify: `src/features/organisations/domain/access.ts`
- Modify: `src/features/organisations/domain/access.test.ts`
- Modify: `src/features/controls/application/crosswalk.ts`
- Create: `src/features/controls/application/crosswalk.test.ts`
- Modify: `src/app/app/frameworks/actions.ts`
- Create: `src/app/app/frameworks/actions.test.ts`

1. Write failing tests for `manage_frameworks`, required rationale, Member
   rejection before rate limit/DB, trusted organisation/actor insertion, UUID
   parsing, exact organisation-scoped delete, and no-match failure.
2. Run the focused tests and confirm failures come from the missing capability,
   optional rationale, and unguarded/unscoped actions.
3. Add `manage_frameworks` to Owner/Admin only. Make `note` required for new
   inputs while retaining nullable database rows for legacy rendering.
4. Add `requireFrameworkManager`; derive tenant/actor from app context; delete
   through `id + organisation_id + select(id) + maybeSingle()`.
5. Re-run focused tests; expect all to pass.

### Task 3: Page experience and accessibility

**Files:**
- Modify: `src/app/app/frameworks/page.tsx`
- Create: `src/app/app/frameworks/page.test.tsx`

1. Write failing Member/operator render tests for the explainer, three ordered
   steps, disclaimer, neutral empty/100% language, accessible table headers,
   requirement-level Covered status, legacy note copy, and role-gated controls.
2. Run the page test and confirm the current crosswalk page fails the new copy,
   status, and role expectations.
3. Build one derived presenter from existing controls, mappings, and SoA rows.
   Render neutral recorded-mapping cards, status/explanation cells, the legacy
   rationale fallback, and Owner/Admin-only guided form/remove buttons.
4. Re-run the page test; expect all role and accessibility assertions to pass.

### Task 4: Database invariant coverage

**Files:**
- Modify: `supabase/tests/database/035_control_crosswalks.sql`

1. Add an ordinary Member fixture and assertions that Member insert/delete are
   denied, while existing Owner mutation and tenant isolation remain green.
2. Run `supabase test db supabase/tests/database/035_control_crosswalks.sql --local`.
3. Adjust only the test fixture/assertion plan if needed; do not weaken or add
   policies unless the existing operator-only RLS actually fails.

### Task 5: Verification and delivery

**Files:**
- Modify only if a verification failure identifies a Phase 6 defect.

1. Run focused framework/access/action/page tests and database test 035.
2. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:db`,
   `npm run build`, `supabase db lint --local`, and `git diff --check`.
3. Stage only Phase 6 files and run `/Users/m1ghty/.git-hooks/pre-commit`.
4. Commit the implementation separately. Do not push, deploy, seed mappings, or
   call any external provider.
