# ComplianceHub — Reorganize, Make Automation Built-in, and Optimize

**Date:** 2026-07-10
**Status:** Approved (design) — pending implementation plan

## Why this work exists

ComplianceHub has an excellent engine but a confusing cockpit. The "it's not
organized / itching my head" feeling is three distinct problems tangled together:

1. **Too many doors.** 21 sidebar items in 4 groups, all equal weight, when only
   ~9 are real destinations. Several are sequential *steps in one flow* dressed up
   as separate features; several are the *same data shown three times*.
2. **Automation narrates itself instead of just working — and part of it is off.**
   UI copy personifies "the daily sweep" ~10 times, so it reads as a bolt-on
   feature. Meanwhile the `evidence-collect` cron exists in code but was never
   scheduled, so the app promises automation it doesn't deliver.
3. **A few things are wired twice or won't scale.** Auth is fetched twice per page,
   assessment autosave silently wedges after one network error, and the nightly
   job loops one-row-at-a-time in a way that will choke at real customer scale.

The domain logic, tests, security model, and empty-state guidance are strong. This
is a **reorganize-and-reframe** job, not a rebuild.

## Scope

One pass, four phased workstreams (A → B → C → D), delivered as a single spec so it
lands in a sensible order. The `src/app/demo/` tree is intentionally out of scope —
it is a 7-screen marketing tour, not duplicated product code.

## Three judgment calls baked into this design

- **JC-1 (nesting via tabs, not route moves):** Child pages keep their existing
  routes. Parent pages gain a tab strip linking to the child. No route renames, no
  data migration, fully reversible.
- **JC-2 (one nightly pipeline, not a third cron):** Fold evidence collection into
  the existing single daily cron as an ordered pipeline (collect → sync → sweep),
  respecting Vercel Hobby cron limits and matching the "automation just runs" goal.
- **JC-3 (standardize on npm):** Remove the pnpm lockfile/workspace, fix the
  `verify` script, add a `packageManager` field. Matches the project's "no pnpm"
  convention.

---

## Workstream A — Make it make sense (navigation & flow)

### A1. New sidebar: 11 doors, funnel-ordered

Rewrite `navGroups` in `src/components/app-shell.tsx` (currently lines 9–35):

```
Dashboard                         (/app, ungrouped, top)
─ GET READY ─
  Gap assessment                  (/app/assessment)
  Risk register                   (/app/risks)          + Assets tab
  Statement of Applicability      (/app/soa)            + Framework coverage tab
  Evidence                        (/app/evidence)
  Tasks                           (/app/tasks)
─ OPERATE ─
  Policies                        (/app/policies)
  Internal audits                 (/app/audits)         + Audit trail tab
  Performance                     (/app/kpis)
─ SHARE ─
  Leadership report               (/app/reports/readiness)
  Trust Center                    (/app/trust)
─ (bottom) ─
  Settings                        (/app/settings)       + Connections tab
```

Removed from the sidebar (routes stay live, reached via tabs or the bell):
`/app/assets`, `/app/frameworks`, `/app/activity`, `/app/integrations`,
`/app/notifications`.

Labels adopt the demo's plain English (`src/components/demo-shell.tsx:10-13`):
Assessment → "Gap assessment", SoA → "Statement of Applicability", Risks → "Risk
register", KPIs → "Performance".

### A2. Single source of truth for nav titles

`app-shell.tsx` currently keeps two lists — `navGroups` (9–35) and a hand-maintained
`TITLES` table (37–48) — that already disagree ("Risks" vs "Risk register"). Derive
the header title from one nav config so they can never drift. Child routes not in the
sidebar (assets, frameworks, activity, integrations) still need titles, so the config
must carry an optional title-only entry list or a small supplementary map — but one
authoritative structure, not two parallel ones.

### A3. Tab strips on parent pages (JC-1)

Introduce a small reusable `Tabs`/`SubNav` component in `src/components/ui.tsx`
(active-state driven by `usePathname`, matching `app-shell`'s `isActive`). Add it to:

- `src/app/app/risks/page.tsx` → tabs: **Risks** | **Assets** (`/app/assets`)
- `src/app/app/soa/page.tsx` → tabs: **SoA** | **Framework coverage** (`/app/frameworks`)
- `src/app/app/audits/page.tsx` → tabs: **Audits** | **Audit trail** (`/app/activity`)
- `src/app/app/settings/page.tsx` → tabs: **Settings** | **Connections** (`/app/integrations`)

The child pages (`assets`, `frameworks`, `activity`, `integrations`) render the same
tab strip so the pair reads as one surface with two views.

### A4. Delete Notifications as a destination

Remove `/app/notifications` from the sidebar. The header bell
(`app-shell.tsx:74`) and the dashboard "Needs attention" widget already carry this
signal. Keep the `/app/notifications` route reachable from the bell (bell links there
today) OR convert the bell into a dropdown — **minimum change: keep the route, just
remove it from the sidebar** and ensure the bell remains the single entry point.

### A5. Fix onboarding checklist order

`src/features/onboarding/domain/checklist.ts` (44–107) currently orders steps
Assessment → Policy → Risk → SoA → Team, which sends users to SoA before it can be
generated. Reorder to match true data dependencies:
**Assessment → SoA → Risks → Evidence → Policy → Team.** Update the pure domain
function + its test (`checklist.test.ts`).

### A6. Empty-state guard on the Leadership report

`src/app/app/reports/readiness/page.tsx` has no empty guard — a brand-new workspace
sees a report of zeros with a "Download PDF" button. Add an `EmptyState` that nudges
"run an assessment first" when there is no finalised SoA register.

### A Acceptance criteria
- Sidebar shows exactly 11 destinations in the funnel order above.
- Every removed page is still reachable via its parent's tab strip (or the bell).
- Header title is derived from a single nav config; no duplicated title list.
- Onboarding checklist steps appear in dependency order; test updated.
- New/empty workspace sees guidance on the Leadership report, not a zero wall.

---

## Workstream B — Make automation invisible & whole

### B1. De-personify all automation copy

Replace every user-facing mention of "the daily sweep" / "the automation" with
outcome language. Known locations (from review):

| File:line | Now | Becomes |
|---|---|---|
| `app/app/page.tsx:65` | "everything the automation is surfacing on its own" | "your open work, evidence freshness, and anything that needs attention" |
| `app/app/page.tsx:79` | "Work the automation has surfaced — start here." | "What needs attention — start here." |
| `app/app/page.tsx:77` | "flagged by the daily sweep" | "past their due date" |
| `app/app/page.tsx:80` | "New work will appear here as the daily sweep runs." | "New items appear here automatically as things fall due or evidence ages." |
| `app/app/page.tsx:12` | source label "Raised by daily sweep" | "Evidence needs refreshing" |
| `app/app/tasks/page.tsx:26` | "flagged by the daily sweep" | "overdue" |
| `app/app/notifications/page.tsx:13,19` | "The daily sweep posts here…" | "Updates appear here when evidence expires or work falls overdue." |
| `app/app/evidence/page.tsx:20,26` | "re-checked by the daily sweep" | "Freshness is tracked automatically; stale items raise a replacement task." |
| `app/app/evidence/new/page.tsx:10` | "the daily sweep will track freshness for you" | "freshness is tracked automatically." |
| `app/app/integrations/page.tsx:68` | "the daily sweep ages them so stale items raise tasks" | "stale items automatically raise a task." |

"Daily sweep" survives only in code/comments (`src/features/automation/**`,
`src/app/api/cron/**`), never in the UI.

### B2. One nightly pipeline (JC-2)

Turn on the collection that never ran, without adding a Hobby-limited cron. Make the
single daily cron run an ordered pipeline: **collect evidence → sync tickets → run
sweep**.

- Keep the three well-tested units (`evidence-collect`, `integrations-sync`,
  `daily-sweep`) as separate functions/modules.
- Have `/api/cron/daily` (`src/app/api/cron/daily/route.ts`) invoke them in order so
  freshly-collected evidence is aged and ticketed in the same run.
- `vercel.json`: keep a single daily cron entry for `/api/cron/daily`. Remove the
  separate `integrations-sync` entry (its work now runs inside the pipeline). The
  standalone route handlers may remain for manual/debug invocation but are no longer
  independently scheduled.
- Order matters: collect first (adds/refreshes evidence), then sync (ticket status),
  then sweep (ages evidence, raises tasks, notifies).

### B3. Demote Integrations into Settings

The Integrations page (`src/app/app/integrations/page.tsx`) becomes the "Connections"
tab of Settings (A3). Soften the "Sandbox mode / going live" framing so it reads as a
normal settings area, not a headline feature. No change to the underlying
connection/evidence-source actions.

### B Acceptance criteria
- No user-facing string references "the daily sweep" or "the automation" as an actor.
- A single daily cron runs collect → sync → sweep in order; `evidence-collect` work
  actually executes on schedule.
- `vercel.json` has one scheduled cron; no orphaned second schedule.
- Integrations lives as a Settings tab; connection/source flows still work.

---

## Workstream C — Make it fast & solid

### C1. Cache the auth/org context (highest-leverage perf win)
`src/app/app/layout.tsx` (16–22) and every page via `requireAppContext()`
(`src/lib/app-context.ts:6-9`) each call `auth.getUser()` + membership queries — so
every `/app/*` render pays 2× GoTrue round-trips + 2× membership queries. Wrap
`requireAppContext` and the underlying `getUser` in React `cache()` so both collapse
to one call per request. Zero behavior change; halves per-page auth latency across
~50 pages.

### C2. Fix the autosave wedge (real bug)
`src/components/assessment-response-form.tsx:9` chains saves on a promise with no
`.catch()`. One thrown fetch (offline/500-before-JSON) rejects the chain and autosave
silently dies for the rest of the session. Append a `.catch()` that resets the chain
to resolved and surfaces "save failed". Preserve the existing serialized-queue +
shared-revision design.

### C3. Make the nightly job scale-safe
In `src/features/automation/application/daily-sweep.ts` and
`src/app/api/cron/daily/route.ts`:
- Preload an `orgId → owner user_ids` map once at the top of the sweep instead of a
  `memberships` lookup per row (removes the N+1).
- Batch notification inserts into a single `upsert(array)` using the existing
  idempotency key, instead of one insert per recipient.
- Batch evidence status updates with one `.in("id", [...])` per target status.
- Change owner lookups from `.single()` to `.maybeSingle()` so an org with no
  owner-role membership can't throw and abort the whole sweep (C3 correctness).
- In `evidence-collect`, replace SELECT-then-INSERT-per-item with
  `upsert(..., { onConflict, ignoreDuplicates: true })`.

### C4. Trim the heaviest list pages
- `src/app/app/evidence/page.tsx:14` fetches all evidence with 4-level nested joins
  and renders the full controls+policies `<select>` inside every card (O(n×m) DOM).
  Hoist the link-picker options into one shared element; add a `.limit()`.
- `src/app/app/tasks/page.tsx:13` fetches all tasks then filters in JS — push the
  status filter into SQL (`.in("status", …)`).
- Add `.limit()` / simple pagination to `risks` and the dashboard controls query,
  filtering to stale-evidence/overdue in SQL where feasible.

### C5. Build hygiene
`next.config.ts:30` externalizes only `pdfkit`. Add `exceljs` and `docx` to
`serverExternalPackages` (both are runtime-only server libs) for faster builds/cold
starts.

### C Acceptance criteria
- A single `/app/*` render issues one `getUser` + one membership query (verified).
- Autosave recovers after a simulated network failure instead of wedging.
- Sweep does O(1) queries per phase, not O(rows); no `.single()` that can abort it.
- Evidence page no longer renders the picker options per card; heavy lists are bounded.

---

## Workstream D — Cleanup

### D1. One package manager (JC-3)
Both `package-lock.json` and `pnpm-lock.yaml` (+ `pnpm-workspace.yaml`) are committed
with no `packageManager` field, so CI/Vercel picks a lockfile nondeterministically.
Standardize on **npm**: delete `pnpm-lock.yaml` and `pnpm-workspace.yaml`, change the
`verify` script (currently `pnpm lint && …`) to npm, add `"packageManager": "npm@<v>"`.
Confirm `sharp`/build-allowlist in the pnpm workspace file isn't actually needed
before deleting (it references deps not in `package.json` — likely stale).

### D2. Extract duplicated helpers
- The timing-safe `authorised()` function is copied verbatim in
  `src/app/api/cron/daily/route.ts:9-16`, `integrations-sync/route.ts:10-17`,
  `evidence-collect/route.ts:10-17`. Extract to `src/lib/security/cron-auth.ts`.
- The Supabase join-normalizer `Array.isArray(x) ? x[0] : x` (and the `one()` helper
  in export routes, e.g. `risks/export/route.ts:6`) is copied ~15 times. Promote to
  `src/lib/supabase/one.ts` and delete the inline copies.

### D Acceptance criteria
- Exactly one lockfile committed; `verify` runs under npm; `packageManager` set.
- Cron auth and the `one()` helper each exist once and are imported everywhere.

---

## Sequencing & verification

Land in order A → B → C → D (B depends on A's Settings tab for B3; the rest are
independent). After each workstream: `npm run typecheck`, targeted `vitest`, and
`playwright` for touched flows. Keep changes reviewable per workstream even though
they ship as one pass.

## Out of scope
- The `src/app/demo/` marketing tour (intentional, low-maintenance).
- Real OAuth for integrations (stays sandbox; only its placement/copy changes).
- `src/proxy.ts` / `src/lib/supabase/proxy.ts` (live Next 16 middleware — leave).
