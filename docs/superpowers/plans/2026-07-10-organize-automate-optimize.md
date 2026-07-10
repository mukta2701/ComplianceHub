# Reorganize + Built-in Automation + Optimization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize ComplianceHub's 21-item navigation into an 11-door funnel, make its automation feel built-in (invisible copy + one nightly pipeline that actually runs), and remove the top performance/reliability rough edges — without a rebuild.

**Architecture:** Next.js 16 App Router with server components + server actions over Supabase (RLS-scoped). The domain logic lives under `src/features/**` (pure, unit-tested) with thin route/page adapters. This plan keeps every existing route live and reversible: pages are *regrouped and relabelled*, child pages are reached through in-page tab strips rather than being moved, and the nightly automation is *composed* from three already-tested units.

**Tech Stack:** TypeScript, Next 16.2.9, React 19.2, Supabase (`@supabase/ssr`), Vitest, Playwright, Tailwind v4.

## How to read this plan (for the human)

- The work is four **workstreams**: **A** = organize the navigation, **B** = make automation built-in, **C** = speed & reliability, **D** = cleanup. Land them A → B → C → D.
- Each **task** starts with **"In plain terms"** (what & why, no jargon) so you can follow along without reading code.
- Each task is small and ends with its own test + commit, so you (or a reviewer) can stop and check after any single task. Nothing is all-or-nothing.
- "TDD" means: write the test first, watch it fail, then write the code that makes it pass. It's how we prove each change does what we claim.

## Global Constraints

- **Framework/runtime:** Next 16.2.9, React 19.2.4 — do not upgrade. `src/proxy.ts` is live Next-16 middleware; do not touch it.
- **Package manager:** npm only. No `pnpm` anywhere after Task 17. E2E runs with `--workers=1` (or `2`).
- **Automation wording rule:** No user-facing string may name "the daily sweep" or "the automation" as an actor. Those terms live only in code/comments (`src/features/automation/**`, `src/app/api/cron/**`).
- **Security invariants (do not regress):** Cron routes stay behind the timing-safe `CRON_SECRET` check. The Integrations page must never `select` `access_token`/`refresh_token`. Supabase queries stay RLS-scoped (no service client in user-facing pages/actions).
- **Design system:** reuse existing classes (`.card`, `.segmented`, `.button`, `.pill`, `EmptyState`, `PageIntro`). Do not introduce a new CSS framework or new global styles unless a task says so.
- **Commit style:** Conventional Commits; small, frequent commits (one per task minimum).

---

# Workstream A — Make it make sense (navigation & flow)

### Task 1: Reusable sub-tab strip component

**In plain terms:** Before we can tuck four pages *inside* other pages (Assets inside Risks, etc.), we need a small "tab strip" widget that shows two links and highlights the one you're on. This task builds that widget once so every pair reuses it.

**Files:**
- Create: `src/components/sub-tabs.tsx`
- Test: `src/components/sub-tabs.test.tsx`

**Interfaces:**
- Produces: `SubTabs({ tabs }: { tabs: { href: string; label: string }[] }): JSX.Element` — a client component that marks a tab active when the current path equals its `href` or starts with `href + "/"`.

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/sub-tabs.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SubTabs } from "./sub-tabs";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/assets" }));

describe("SubTabs", () => {
  it("marks the tab matching the current path as active", () => {
    render(<SubTabs tabs={[{ href: "/app/risks", label: "Risks" }, { href: "/app/assets", label: "Assets" }]} />);
    expect(screen.getByRole("link", { name: "Assets" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Risks" })).not.toHaveAttribute("aria-current");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/sub-tabs.test.tsx`
Expected: FAIL — cannot resolve `./sub-tabs`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/components/sub-tabs.tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function SubTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(`${href}/`);
  return (
    <nav className="segmented" aria-label="Section" style={{ marginBottom: "16px" }}>
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={active(t.href) ? "page" : undefined} className={active(t.href) ? "active" : ""}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/sub-tabs.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/sub-tabs.tsx src/components/sub-tabs.test.tsx
git commit -m "feat(nav): add reusable SubTabs strip for nested sections"
```

---

### Task 2: Rewrite the sidebar into 11 funnel-ordered doors with one title source

**In plain terms:** This is the headline "organization" change. We shrink the sidebar from 21 items to 11, order them the way you actually work (Get ready → Operate → Share → Admin), give them plain-English names, and pull Dashboard out as the home link at the top. We also delete the second, hand-maintained title list that had drifted out of sync, deriving the page title from one place so it can never disagree again. Assets, Frameworks, Activity, Integrations, and Notifications leave the sidebar — they're reached via tab strips (Tasks 3–6) or the bell.

**Files:**
- Modify: `src/components/app-shell.tsx:9-64` (the `navGroups` array, the `TITLES` array, and the `title` lookup)

**Interfaces:**
- Consumes: `SubTabs` is unrelated here; this task only edits `app-shell.tsx`.
- Produces: unchanged `AppShell` props; internal `navGroups` + a single `TITLE_ROUTES` list.

- [ ] **Step 1: Replace `navGroups` (lines 9–35) with the funnel structure**

```tsx
const navGroups = [
  { label: "Get ready", items: [
    ["/app/assessment", "clipboard", "Gap assessment"],
    ["/app/risks", "alert", "Risk register"],
    ["/app/soa", "file", "Statement of Applicability"],
    ["/app/evidence", "file", "Evidence"],
    ["/app/tasks", "check", "Tasks"],
  ] },
  { label: "Operate", items: [
    ["/app/policies", "file", "Policies"],
    ["/app/audits", "shield", "Internal audits"],
    ["/app/kpis", "check", "Performance"],
  ] },
  { label: "Share", items: [
    ["/app/reports/readiness", "file", "Leadership report"],
    ["/app/trust", "shield", "Trust Center"],
  ] },
  { label: "Admin", items: [
    ["/app/settings", "settings", "Settings"],
  ] },
] as const;
```

- [ ] **Step 2: Replace the `TITLES` array (lines 37–48) with a single derived source**

The old `TITLES` list duplicated nav labels and disagreed with them. Build the title lookup *from* `navGroups`, plus a small `EXTRA_TITLES` map for routes that are no longer in the sidebar but still need a header (nested pages, imports, wizards). Order longest-path-first so the most specific match wins.

```tsx
// Routes not in the sidebar still need a header title.
const EXTRA_TITLES: Array<[string, string]> = [
  ["/app", "Dashboard"],
  ["/app/assets/import", "Import asset inventory"],
  ["/app/assets", "Asset inventory"],
  ["/app/frameworks", "Framework coverage"],
  ["/app/activity", "Audit trail"],
  ["/app/integrations", "Connections"],
  ["/app/notifications", "Notifications"],
  ["/app/risks/import", "Import risk register"],
  ["/app/soa/import", "Import Statement of Applicability"],
  ["/app/audits/new", "Plan an audit"],
  ["/app/policies/new", "Author a policy"],
  ["/app/onboarding", "Workspace setup"],
  ["/app/invitations", "Invitation"],
];
const TITLE_ROUTES: Array<[string, string]> = [
  ...navGroups.flatMap((g) => g.items.map(([href, , label]) => [href, label] as [string, string])),
  ...EXTRA_TITLES,
].sort((a, b) => b[0].length - a[0].length);
```

- [ ] **Step 3: Update the `title` lookup (line 64)**

Change:
```tsx
const title = TITLES.find(([href]) => isActive(path, href))?.[1] ?? "ComplianceHub";
```
to:
```tsx
const title = TITLE_ROUTES.find(([href]) => isActive(path, href))?.[1] ?? "ComplianceHub";
```

- [ ] **Step 4: Add the Dashboard home link above the groups**

In the `<nav aria-label="Workspace">` block (line 70), render a standalone Dashboard link before mapping `navGroups`, so Dashboard is the home door and not inside a group:

```tsx
<nav aria-label="Workspace">
  <div className="nav-group">
    <Link ref={firstNav} href="/app" className={isActive(path, "/app") ? "active" : ""} aria-current={isActive(path, "/app") ? "page" : undefined} onClick={() => setOpen(false)}>
      <Icon name="home" />Dashboard
    </Link>
  </div>
  {navGroups.map((group) => (
    <div className="nav-group" key={group.label}>
      <p className="nav-section-label">{group.label}</p>
      {group.items.map(([href, icon, label]) => (
        <Link key={href} href={href} className={isActive(path, href) ? "active" : ""} aria-current={isActive(path, href) ? "page" : undefined} onClick={() => setOpen(false)}>
          <Icon name={icon} />{label}
        </Link>
      ))}
    </div>
  ))}
</nav>
```
Note: the `firstNav` ref moves onto the Dashboard link (it used to sit on the `/app` item inside the group); remove the old `ref={href === "/app" ? firstNav : undefined}` from the group map so the ref is only bound once.

- [ ] **Step 5: Verify — typecheck, build, and a nav smoke test**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test -- e2e` is not applicable here; instead run the dev server and confirm the sidebar shows exactly 11 grouped doors + Dashboard, and that visiting `/app/assets` still shows the "Asset inventory" title. If an `e2e` nav spec exists that asserts old labels (grep `e2e` for "Notifications"/"Frameworks"), update it to the new labels.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/components/app-shell.tsx
git commit -m "feat(nav): 11-door funnel sidebar with single title source"
```

---

### Task 3: Nest Assets inside Risks (tab strip)

**In plain terms:** Assets only exist to be linked to Risks, so they become the second tab of the Risk register instead of a separate sidebar item. Both pages show the same two-tab strip so they read as one place with two views.

**Files:**
- Modify: `src/app/app/risks/page.tsx` (add the strip near the top of the returned markup, after `PageIntro`)
- Modify: `src/app/app/assets/page.tsx` (add the same strip)

**Interfaces:**
- Consumes: `SubTabs` from Task 1.

- [ ] **Step 1: Add the import and strip to `risks/page.tsx`**

Add to imports:
```tsx
import { SubTabs } from "@/components/sub-tabs";
```
Immediately after the `<PageIntro … />` element (ends at line 33), add:
```tsx
<SubTabs tabs={[{ href: "/app/risks", label: "Risks" }, { href: "/app/assets", label: "Assets" }]} />
```

- [ ] **Step 2: Add the same import + strip to `assets/page.tsx`**

Add the `SubTabs` import, and render the identical strip immediately after that page's `PageIntro`:
```tsx
<SubTabs tabs={[{ href: "/app/risks", label: "Risks" }, { href: "/app/assets", label: "Assets" }]} />
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: no errors. In the browser, `/app/risks` and `/app/assets` both show the two-tab strip with the correct tab active.

- [ ] **Step 4: Commit**

```bash
git add src/app/app/risks/page.tsx src/app/app/assets/page.tsx
git commit -m "feat(nav): nest Assets under Risks via tab strip"
```

---

### Task 4: Nest Framework coverage inside SoA (tab strip)

**In plain terms:** The framework crosswalk is a read-out of your SoA, so it becomes SoA's second tab. This also fixes the "why is there an empty Frameworks tab before I've done anything" confusion.

**Files:**
- Modify: `src/app/app/soa/page.tsx` (add strip after `PageIntro`)
- Modify: `src/app/app/frameworks/page.tsx` (add same strip)

- [ ] **Step 1: Add to `soa/page.tsx`**

Import `SubTabs`, then after the page's `PageIntro`:
```tsx
<SubTabs tabs={[{ href: "/app/soa", label: "Statement of Applicability" }, { href: "/app/frameworks", label: "Framework coverage" }]} />
```

- [ ] **Step 2: Add the same strip to `frameworks/page.tsx`** (import `SubTabs`, render after its `PageIntro`).

- [ ] **Step 3: Verify** — `npm run typecheck`; browse `/app/soa` and `/app/frameworks`, confirm the strip and active state.

- [ ] **Step 4: Commit**

```bash
git add src/app/app/soa/page.tsx src/app/app/frameworks/page.tsx
git commit -m "feat(nav): nest Framework coverage under SoA via tab strip"
```

---

### Task 5: Nest the Audit trail (Activity) inside Internal audits (tab strip)

**In plain terms:** The Activity log is a monthly reference, not a daily door, and it's really the audit trail — so it becomes a tab of Internal audits.

**Files:**
- Modify: `src/app/app/audits/page.tsx` (add strip after `PageIntro`)
- Modify: `src/app/app/activity/page.tsx` (add same strip)

- [ ] **Step 1: Add to `audits/page.tsx`**

Import `SubTabs`, then after its `PageIntro`:
```tsx
<SubTabs tabs={[{ href: "/app/audits", label: "Internal audits" }, { href: "/app/activity", label: "Audit trail" }]} />
```

- [ ] **Step 2: Add the same strip to `activity/page.tsx`.**

- [ ] **Step 3: Verify** — `npm run typecheck`; browse both pages.

- [ ] **Step 4: Commit**

```bash
git add src/app/app/audits/page.tsx src/app/app/activity/page.tsx
git commit -m "feat(nav): nest Audit trail under Internal audits via tab strip"
```

---

### Task 6: Move Integrations under Settings (Connections tab)

**In plain terms:** Connections are configuration, so they belong in Settings, not as a headline feature. We add a two-tab strip to both Settings and the Integrations page. (The wording on the Integrations page is softened later, in Task 11.)

**Files:**
- Modify: `src/app/app/settings/page.tsx` (add strip after `PageIntro`, line 28)
- Modify: `src/app/app/integrations/page.tsx` (add same strip after its `PageIntro`, line 23)

- [ ] **Step 1: Add to `settings/page.tsx`**

Import `SubTabs`, then after the `PageIntro`:
```tsx
<SubTabs tabs={[{ href: "/app/settings", label: "Settings" }, { href: "/app/integrations", label: "Connections" }]} />
```

- [ ] **Step 2: Add the same strip to `integrations/page.tsx`** (after its `PageIntro`).

- [ ] **Step 3: Verify** — `npm run typecheck`; browse `/app/settings` and `/app/integrations`.

- [ ] **Step 4: Commit**

```bash
git add src/app/app/settings/page.tsx src/app/app/integrations/page.tsx
git commit -m "feat(nav): move Integrations under Settings as Connections tab"
```

---

### Task 7: Fix the onboarding checklist order to match reality

**In plain terms:** Today the getting-started checklist sends you to build your SoA *before* the assessment that generates it. We reorder the steps to the real dependency order — Assessment → SoA → Risks → Evidence → Policy → Team — so the guidance stops contradicting the app.

**Files:**
- Modify: `src/features/onboarding/domain/checklist.ts:44-93` (the `steps` array order + add an Evidence step input)
- Modify: `src/features/onboarding/domain/checklist.test.ts`

**Interfaces:**
- Produces: `OnboardingInputs` gains `hasEvidence: boolean`. `buildOnboardingChecklist` returns steps in the new order.
- Consumes (downstream): `src/app/app/page.tsx:35-42` must pass `hasEvidence` (wire in Step 5).

- [ ] **Step 1: Write/adjust the failing test**

Add to `checklist.test.ts` (mirror the existing test style — plain inputs, assert order):
```ts
import { describe, expect, it } from "vitest";
import { buildOnboardingChecklist } from "./checklist";

describe("buildOnboardingChecklist order", () => {
  it("orders steps by real data dependency: assessment, soa, risk, evidence, policy, team", () => {
    const { steps } = buildOnboardingChecklist({
      hasAssessment: false, hasSoa: false, hasRisk: false, hasEvidence: false, hasPolicy: false, hasTeam: false,
    });
    expect(steps.map((s) => s.id)).toEqual([
      "workspace", "assessment", "soa", "risk", "evidence", "policy", "team",
    ]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/features/onboarding/domain/checklist.test.ts`
Expected: FAIL — order mismatch and/or `hasEvidence` not accepted.

- [ ] **Step 3: Implement**

In `checklist.ts`: add `hasEvidence: boolean;` to `OnboardingInputs` (after `hasSoa`). Reorder the `steps` array so it reads: `workspace`, `assessment`, `soa`, `risk`, `evidence`, `policy`, `team`. Use these two moved/new entries:

```ts
    {
      id: "soa",
      label: "Generate your Statement of Applicability",
      description: "Turn the assessment into a control-by-control SoA register.",
      href: "/app/soa",
      cta: "Open SoA",
      done: inputs.hasSoa,
    },
    {
      id: "risk",
      label: "Add your first risk",
      description: "Track inherent and residual exposure on the 5×5 matrix.",
      href: "/app/risks/new",
      cta: "Add risk",
      done: inputs.hasRisk,
    },
    {
      id: "evidence",
      label: "Attach your first evidence",
      description: "Link proof to a control — freshness is then tracked automatically.",
      href: "/app/evidence/new",
      cta: "Add evidence",
      done: inputs.hasEvidence,
    },
```
Keep `policy` and `team` after `evidence`, and keep the optional `integration` push at the end unchanged.

- [ ] **Step 4: Run tests to confirm green**

Run: `npm test -- src/features/onboarding/domain/checklist.test.ts`
Expected: PASS (both the new test and the existing ones — update any existing test that asserted the old order).

- [ ] **Step 5: Wire `hasEvidence` from the dashboard**

In `src/app/app/page.tsx`: the `Promise.all` (line 17) already counts many things. Add an evidence-count signal and pass it into `buildOnboardingChecklist`. There is already a `liveEvidence` count (line 23) — reuse it:
```tsx
  const checklist = buildOnboardingChecklist({
    hasAssessment: (assessments ?? 0) > 0,
    hasSoa: (soaRegisters ?? 0) > 0 || (snapshots ?? 0) > 0,
    hasRisk: (allRisks ?? 0) > 0,
    hasEvidence: (liveEvidence ?? 0) > 0,
    hasPolicy: (policies ?? 0) > 0,
    hasTeam: (members ?? 0) > 1 || (invites ?? 0) > 0,
    hasIntegration: (integrations ?? 0) > 0,
  });
```

- [ ] **Step 6: Verify + commit**

Run: `npm run typecheck && npm test -- src/features/onboarding`
Expected: PASS.
```bash
git add src/features/onboarding/domain/checklist.ts src/features/onboarding/domain/checklist.test.ts src/app/app/page.tsx
git commit -m "fix(onboarding): order checklist by real data dependencies, add evidence step"
```

---

### Task 8: Empty-state guard on the Leadership report

**In plain terms:** A brand-new workspace opening the Leadership report currently sees a wall of zeros and a "Download PDF" button. We show a friendly "run an assessment first" nudge instead, until there's a finalised SoA to report on.

**Files:**
- Modify: `src/app/app/reports/readiness/page.tsx`

- [ ] **Step 1: Read the page to find the readiness data it already loads**

Run: `sed -n '1,40p' src/app/app/reports/readiness/page.tsx` — identify the variable holding the SoA register / readiness figures (there will be a query for the latest `soa_registers` or the summarised readiness).

- [ ] **Step 2: Add the guard**

Import `EmptyState` from `@/components/ui` if not already imported. After the data is loaded and before rendering the report body, add:
```tsx
  if (!register) {
    return (
      <>
        <PageIntro eyebrow="REPORTS" title="Leadership report" body="A board-ready summary of your readiness posture." />
        <EmptyState
          icon="file"
          title="Run an assessment first"
          body="This report summarises your Statement of Applicability. Complete a gap assessment to generate one, then come back for a board-ready readiness report."
          primary={{ href: "/app/assessment", label: "Start assessment" }}
        />
      </>
    );
  }
```
Use the actual variable name found in Step 1 in place of `register` (it is the "no finalised SoA register" signal).

- [ ] **Step 3: Verify** — `npm run typecheck`; load `/app/reports/readiness` on a fresh workspace and confirm the nudge shows instead of zeros.

- [ ] **Step 4: Commit**

```bash
git add src/app/app/reports/readiness/page.tsx
git commit -m "feat(reports): guide empty Leadership report toward running an assessment"
```

---

# Workstream B — Make automation built-in

### Task 9: De-personify all automation copy

**In plain terms:** Stop the app talking about "the daily sweep" and "the automation" as if they were a person. Users should just see *outcomes* ("Overdue", "Needs attention"), not the machinery. This is pure wording — no logic changes.

**Files (exact strings to replace):**
- Modify: `src/app/app/page.tsx` — lines 12, 65, 77, 79, 80
- Modify: `src/app/app/tasks/page.tsx` — line 26
- Modify: `src/app/app/evidence/page.tsx` — lines 20, 26
- Modify: `src/app/app/evidence/new/page.tsx` — line 10
- Modify: `src/app/app/notifications/page.tsx` — lines 13, 19
- Modify: `src/app/app/integrations/page.tsx` — line 68

- [ ] **Step 1: Dashboard (`src/app/app/page.tsx`)**

- Line 12, in `SOURCE_LABEL`: `evidence_expiry: "Raised by daily sweep"` → `evidence_expiry: "Evidence needs refreshing"`.
- Line 65 body: `"Your live view of open work, evidence freshness, and everything the automation is surfacing on its own."` → `"Your live view of open work, evidence freshness, and anything that needs attention."`
- Line 77, OVERDUE stat detail: `detail="flagged by the daily sweep"` → `detail="past their due date"`.
- Line 79 card copy: `<p>Work the automation has surfaced — start here.</p>` → `<p>What needs attention — start here.</p>`.
- Line 80 empty state: `"Nothing needs attention right now. New work will appear here as the daily sweep runs."` → `"Nothing needs attention right now. New items appear here automatically as things fall due or evidence ages."`

- [ ] **Step 2: Tasks (`src/app/app/tasks/page.tsx:26`)**

`<Stat label="OVERDUE" value={overdueCount} detail="flagged by the daily sweep" tone="red" />` → `detail="past their due date"`.

- [ ] **Step 3: Evidence list (`src/app/app/evidence/page.tsx`)**

- Line 20 body: `"Immutable proof attached to controls — freshness is re-checked by the daily sweep, and stale items raise tasks automatically."` → `"Immutable proof attached to controls. Freshness is tracked automatically, and stale items raise a replacement task."`
- Line 26 empty state body: `"…The daily sweep re-checks freshness and raises a replacement task automatically when something goes stale."` → `"…Freshness is tracked automatically, and a replacement task is raised when something goes stale."`

- [ ] **Step 4: Add-evidence (`src/app/app/evidence/new/page.tsx:10`)**

Replace `"…the daily sweep will track freshness for you."` → `"…freshness is then tracked automatically."` (match the surrounding sentence).

- [ ] **Step 5: Notifications (`src/app/app/notifications/page.tsx`)**

- Line 13 body: `"Automation and workspace updates. The daily sweep posts here when evidence expires or work falls overdue."` → `"Updates appear here automatically when evidence expires or work falls overdue."`
- Line 19 empty state: `"The daily sweep will post here when something changes."` → `"Updates will appear here when something changes."`

- [ ] **Step 6: Integrations (`src/app/app/integrations/page.tsx:68`)**

`"…and the daily sweep ages them so stale items raise tasks on their own."` → `"…and stale items automatically raise a task."`

- [ ] **Step 7: Verify no personified copy remains**

Run: `grep -rin "daily sweep\|the automation" src/app`
Expected: **zero** matches under `src/app/app` and `src/app/demo` (matches under `src/app/api/cron` are code/comments and are allowed). If the demo tree (`src/app/demo/evidence/page.tsx:12`) also has "daily sweep", apply the same outcome wording there.

- [ ] **Step 8: Commit**

```bash
git add src/app/app src/app/demo
git commit -m "refactor(copy): describe automation by outcome, not as an actor"
```

---

### Task 10: One nightly pipeline that actually runs (collect → sync → sweep)

**In plain terms:** The "collect evidence automatically" job was written but never scheduled, so it never ran. Instead of adding a third scheduled job (which Vercel's free tier limits), we make the single nightly job do the whole pipeline in order: **collect fresh evidence → sync ticket statuses → age evidence and raise tasks.** We do this by lifting the two loops out of their standalone route files into reusable functions, then calling all three from the daily cron.

**Files:**
- Create: `src/features/integrations/application/collect-run.ts` (holds `collectEvidence`)
- Create: `src/features/integrations/application/sync-run.ts` (holds `syncTickets`)
- Modify: `src/app/api/cron/evidence-collect/route.ts` (call the extracted function)
- Modify: `src/app/api/cron/integrations-sync/route.ts` (call the extracted function)
- Modify: `src/app/api/cron/daily/route.ts` (run the pipeline)
- Modify: `vercel.json` (single daily cron)

**Interfaces:**
- Produces:
  - `collectEvidence(supabase: SupabaseClient): Promise<{ collected: number; refreshed: number; failed: number }>`
  - `syncTickets(supabase: SupabaseClient): Promise<{ synced: number; failed: number; tasksClosed: number }>`
- Consumes: the daily route already builds a service client and `SweepDependencies`.

- [ ] **Step 1: Extract `collectEvidence`**

Create `src/features/integrations/application/collect-run.ts` and move the body of `evidence-collect/route.ts` lines 21–69 into it (verbatim logic — this is a move, not a rewrite), typed against the service client:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveEvidenceProvider } from "./evidence-registry";
import { toEvidenceRow } from "../domain/evidence-collection";
import type { EvidenceProviderKind } from "../domain/evidence-provider";

export async function collectEvidence(supabase: SupabaseClient): Promise<{ collected: number; refreshed: number; failed: number }> {
  const { data: sources, error } = await supabase.from("evidence_sources")
    .select("id,organisation_id,provider,config,access_token,connected_by")
    .is("revoked_at", null);
  if (error) throw error;
  let collected = 0, refreshed = 0, failed = 0;
  for (const source of sources ?? []) {
    try {
      const provider = resolveEvidenceProvider(source.provider as EvidenceProviderKind);
      const items = await provider.collect({
        id: source.id, provider: source.provider as EvidenceProviderKind,
        config: (source.config ?? {}) as Record<string, unknown>, accessToken: source.access_token ?? "",
      });
      for (const item of items) {
        const row = toEvidenceRow(item, { organisationId: source.organisation_id, sourceId: source.id });
        const { data: existing, error: lookupError } = await supabase.from("evidence")
          .select("id").eq("source_id", source.id).eq("external_ref", row.external_ref)
          .eq("organisation_id", source.organisation_id).maybeSingle();
        if (lookupError) throw lookupError;
        if (existing) { refreshed += 1; continue; }
        const { error: insertError } = await supabase.from("evidence").insert({ ...row, created_by: source.connected_by });
        if (insertError) throw insertError;
        collected += 1;
      }
    } catch { failed += 1; }
  }
  return { collected, refreshed, failed };
}
```

- [ ] **Step 2: Point the standalone `evidence-collect` route at the function**

Replace lines 19–70 of `evidence-collect/route.ts` so `collect()` becomes:
```ts
import { collectEvidence } from "@/features/integrations/application/collect-run";
// …authorised() stays for now (removed in Task 18)…
async function collect(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  const supabase = createSupabaseServiceClient();
  return NextResponse.json(await collectEvidence(supabase));
}
```

- [ ] **Step 3: Extract `syncTickets` the same way**

Create `src/features/integrations/application/sync-run.ts` with the body of `integrations-sync/route.ts` lines 21–65 moved verbatim into `syncTickets(supabase)` (imports: `resolveTicketProvider`, `isTerminalTicketStatus`, `isTicketSyncDue`, `IntegrationProvider`). Then reduce `integrations-sync/route.ts`'s `sync()` to call it, mirroring Step 2.

- [ ] **Step 4: Run the pipeline from the daily cron**

In `src/app/api/cron/daily/route.ts`, import the two functions and run them before the sweep. In `sweep()` (line 18), after building `supabase` (line 20) and before building `deps`, add:
```ts
import { collectEvidence } from "@/features/integrations/application/collect-run";
import { syncTickets } from "@/features/integrations/application/sync-run";
// …
  const collectResult = await collectEvidence(supabase);
  const syncResult = await syncTickets(supabase);
```
Then change the final return (line 114) to include all three results:
```ts
  const summary = await runDailySweep(deps);
  return NextResponse.json({ collect: collectResult, sync: syncResult, sweep: summary });
```
Order matters: collect first (adds/refreshes evidence), then sync (ticket status), then sweep (ages evidence, raises tasks, notifies).

- [ ] **Step 5: Schedule one nightly cron**

Replace `vercel.json` with a single scheduled job (the standalone routes remain callable for manual/debug use, just no longer independently scheduled):
```json
{
  "crons": [
    { "path": "/api/cron/daily", "schedule": "0 6 * * *" }
  ]
}
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck`
Expected: no errors.
Run: `npm test -- src/app/api/cron/daily` (existing route tests — the sweep behaviour is unchanged, so they should still pass; if they assert the exact JSON shape, update the expected shape to the new `{ collect, sync, sweep }`).
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/integrations/application/collect-run.ts src/features/integrations/application/sync-run.ts src/app/api/cron vercel.json
git commit -m "feat(automation): run collect→sync→sweep as one nightly pipeline"
```

---

### Task 11: Soften the Connections copy so it reads as settings, not a feature

**In plain terms:** Now that Connections lives inside Settings, tone down the "Sandbox mode / going live" framing so it feels like a normal setup area rather than an advanced product. No logic changes — the sandbox behaviour stays; only the words change.

**Files:**
- Modify: `src/app/app/integrations/page.tsx` (the `PageIntro` at line 23, and the "Sandbox mode" `Pill` + intro paragraphs at lines 26–37 and 63–74)

- [ ] **Step 1: Retitle the page**

Line 23 `PageIntro`: change `eyebrow="INTEGRATIONS"` → `eyebrow="SETTINGS · CONNECTIONS"`, `title="Ticketing integrations"` → `title="Connections"`, and body → `"Connect a tracker to push remediation tasks as tickets, and a source so proof is collected for you. Both start in a safe sandbox."`

- [ ] **Step 2: Downgrade the "Sandbox mode" pills to a calm note**

Keep the `<Pill tone="amber">Sandbox mode</Pill>` markers (they're honest), but change the surrounding heading emphasis: line 28 `<h2>Connect Jira or GitHub</h2>` → `<h2>Task tracker</h2>`; line 65 `<h2>Evidence sources</h2>` stays. This is wording only; do not touch the `<form>` actions or the `<details>` "going live" blocks (they remain accurate).

- [ ] **Step 3: Verify** — `npm run typecheck`; load `/app/settings` → Connections tab and read it as a settings area.

- [ ] **Step 4: Commit**

```bash
git add src/app/app/integrations/page.tsx
git commit -m "refactor(copy): present Connections as a settings area"
```

---

# Workstream C — Speed & reliability

### Task 12: Cache the auth/org context (halve per-page auth work)

**In plain terms:** Every page currently asks Supabase "who is logged in?" and "what workspace?" *twice* — once in the layout and once in the page — on the same request. We wrap those two questions in React's per-request cache so they run once and the page reuses the answer. No behavior changes; pages just get faster.

**Files:**
- Modify: `src/lib/app-context.ts`
- Modify: `src/app/app/layout.tsx`

**Interfaces:**
- Produces: `getAuthUser(): Promise<User | null>` and `getMembership(): Promise<MembershipRow | null>` — both `cache()`-wrapped, both non-redirecting. `requireAppContext()` keeps its current return shape and its redirects.

- [ ] **Step 1: Add cached primitives to `app-context.ts`**

Rewrite `src/lib/app-context.ts` to:
```ts
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const getAuthUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});

export const getMembership = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("memberships")
    .select("organisation_id,role,organisations(id,name)").limit(1).maybeSingle();
  return data;
});

export async function requireAppContext() {
  const supabase = await createSupabaseServerClient();
  const user = await getAuthUser();
  if (!user) redirect("/sign-in");
  const membership = await getMembership();
  if (!membership) redirect("/app/onboarding");
  const organisation = Array.isArray(membership.organisations) ? membership.organisations[0] : membership.organisations;
  return { supabase, user, membership, organisation: organisation as { id: string; name: string } };
}
```
Note: `getMembership` must **not** redirect — the layout wraps `/app/onboarding` (which has no membership yet), so a redirecting membership fetch there would loop.

- [ ] **Step 2: Reuse the cached primitives in the layout**

In `src/app/app/layout.tsx`, replace the standalone `getUser` + membership query (lines 16–23) with the cached helpers, keeping the still-unique `notifications` and `profiles` fetches:
```tsx
import { getAuthUser, getMembership } from "@/lib/app-context";
// …
  const supabase = await createSupabaseServerClient();
  const user = await getAuthUser();
  if (!user) redirect("/sign-in");
  const membership = await getMembership();
  const [{ count: unread }, { data: profile }] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
  ]);
  const organisation = membership ? (Array.isArray(membership.organisations) ? membership.organisations[0] : membership.organisations) : null;
```
Now the layout's `getAuthUser()`/`getMembership()` and every page's `requireAppContext()` share one cached result per request.

- [ ] **Step 3: Verify (evidence, not assertion)**

Run: `npm run typecheck && npm run build`
Expected: both succeed.
Manual check: run `npm run dev`, sign in, and confirm `/app`, `/app/risks`, `/app/settings` all render normally (context still resolves), and `/app/onboarding` still loads for a user without a workspace (no redirect loop). React `cache()` dedups within a single request by design, so layout + page now issue one `getUser` and one membership query instead of two of each.

- [ ] **Step 4: Commit**

```bash
git add src/lib/app-context.ts src/app/app/layout.tsx
git commit -m "perf(auth): cache per-request auth + membership across layout and pages"
```

---

### Task 13: Fix the autosave wedge

**In plain terms:** In the assessment, answers save as you type. Right now, if one save hits a network error, autosave silently dies for the rest of the session — the field just sits on "saving" forever. One missing safety net causes it. We add the net and prove it with a test.

**Files:**
- Modify: `src/components/assessment-response-form.tsx:9`
- Test: `src/components/assessment-response-form.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/assessment-response-form.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssessmentResponseList } from "./assessment-response-form";

afterEach(() => vi.restoreAllMocks());

const props = {
  sessionId: "s1", initialRevision: 1,
  questions: [{ id: "q1", code: "A.5.1", prompt: "Policy exists?" }],
  responses: [{ question_id: "q1", answer: null, evidence_note: "" }],
};

describe("AssessmentResponseList autosave recovery", () => {
  it("recovers after a failed save instead of wedging", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ revision: 2 }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentResponseList {...props} />);
    const select = screen.getByRole("combobox");
    await userEvent.selectOptions(select, "yes");   // first save -> rejects
    await waitFor(() => expect(screen.getByText("save failed")).toBeInTheDocument());
    await userEvent.selectOptions(select, "no");    // second save -> must still run
    await waitFor(() => expect(screen.getByText("saved")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/components/assessment-response-form.test.tsx`
Expected: FAIL — after the rejected first save, the second `selectOptions` never reaches "saved" (the promise chain is stuck on a rejection).

- [ ] **Step 3: Implement the one-line fix**

In `assessment-response-form.tsx:9`, the `save` function chains `queue.current = queue.current.then(async () => { … })`. Append a `.catch` so a thrown fetch resets the chain to resolved and surfaces the failure:
```tsx
queue.current = queue.current.then(async () => {
  const result = await fetch("/api/app/assessment/response", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId, questionId, answer: values.answer, evidenceNote: values.evidenceNote, expectedRevision: revision.current }) });
  const body = await result.json();
  if (!result.ok) { setStates((s) => ({ ...s, [questionId]: result.status === 409 ? "conflict — reload required" : "save failed" })); return; }
  revision.current = body.revision; setStates((s) => ({ ...s, [questionId]: "saved" }));
}).catch(() => { setStates((s) => ({ ...s, [questionId]: "save failed" })); });
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- src/components/assessment-response-form.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/assessment-response-form.tsx src/components/assessment-response-form.test.tsx
git commit -m "fix(assessment): recover autosave after a failed request"
```

---

### Task 14: Make the nightly sweep scale-safe (owner lookups + missing-owner safety)

**In plain terms:** The nightly job looks up "who owns this workspace" once per row, which becomes thousands of repeated database calls at real scale, and it crashes the *whole* run if any one workspace has no owner. We look each workspace's owners up once and cache it, and we make a missing owner skip that item instead of aborting everyone's run.

> **Scope note (honest deviation from spec C3):** the spec also lists batching the notification/status writes into single calls. That would require rewriting the well-tested `runDailySweep` domain contract, which is higher risk than value before real tenant scale. This task delivers the two high-value, low-risk parts now (owner-lookup de-duplication + missing-owner safety); bulk-insert batching is deferred and noted in the code as a future optimization. Flag this if you'd rather do the full batching now.

**Files:**
- Create: `src/features/automation/application/owner-resolver.ts`
- Test: `src/features/automation/application/owner-resolver.test.ts`
- Modify: `src/app/api/cron/daily/route.ts` (use the resolver; `.single()` → resolver lookup)

**Interfaces:**
- Produces: `memoizeOwners(fetchOwners: (orgId: string) => Promise<string[]>): (orgId: string) => Promise<string[]>` — returns a function that calls `fetchOwners` at most once per `orgId`.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/automation/application/owner-resolver.test.ts
import { describe, expect, it, vi } from "vitest";
import { memoizeOwners } from "./owner-resolver";

describe("memoizeOwners", () => {
  it("fetches each org's owners only once", async () => {
    const fetchOwners = vi.fn(async (orgId: string) => [`${orgId}-owner`]);
    const resolve = memoizeOwners(fetchOwners);
    expect(await resolve("org1")).toEqual(["org1-owner"]);
    expect(await resolve("org1")).toEqual(["org1-owner"]);
    expect(await resolve("org2")).toEqual(["org2-owner"]);
    expect(fetchOwners).toHaveBeenCalledTimes(2); // org1 once, org2 once
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/features/automation/application/owner-resolver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/automation/application/owner-resolver.ts
export function memoizeOwners(fetchOwners: (orgId: string) => Promise<string[]>): (orgId: string) => Promise<string[]> {
  const cache = new Map<string, Promise<string[]>>();
  return (orgId: string) => {
    let pending = cache.get(orgId);
    if (!pending) { pending = fetchOwners(orgId); cache.set(orgId, pending); }
    return pending;
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/features/automation/application/owner-resolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the resolver into the daily route**

In `src/app/api/cron/daily/route.ts`, after `const supabase = createSupabaseServiceClient();` (line 20), add:
```ts
import { memoizeOwners } from "@/features/automation/application/owner-resolver";
// …
  const resolveOwners = memoizeOwners(async (organisationId) => {
    const { data, error } = await supabase.from("memberships")
      .select("user_id").eq("organisation_id", organisationId).eq("role", "owner");
    if (error) throw error;
    return (data ?? []).map((row) => row.user_id as string);
  });
```
Then:
- Replace `listOrganisationOwners` (lines 97–102) with: `listOrganisationOwners: (organisationId) => resolveOwners(organisationId),`.
- In `createTask` (lines 44–56), replace the `.single()` owner lookup (lines 45–47) with the resolver and a missing-owner skip:
```ts
    createTask: async (task) => {
      const owners = await resolveOwners(task.organisationId);
      if (owners.length === 0) return false; // an org with no owner can't be assigned a creator — skip, don't abort
      const { data, error } = await supabase.from("tasks").upsert({
        organisation_id: task.organisationId, title: task.title,
        detail: "Raised automatically because linked evidence is expiring or expired.",
        source: "evidence_expiry", owner_id: task.ownerId, due_on: task.dueOn,
        evidence_id: task.evidenceId, created_by: owners[0],
      }, { onConflict: "organisation_id,evidence_id,source", ignoreDuplicates: true }).select("id");
      if (error) throw error;
      return Boolean(data?.length);
    },
```
- Apply the same pattern in `createPolicyReviewTask` (lines 83–96): replace its `.single()` lookup with `const owners = await resolveOwners(task.organisationId); if (owners.length === 0) return false;` and use `created_by: owners[0]`.

- [ ] **Step 6: Verify the sweep still behaves**

Run: `npm test -- src/features/automation src/app/api/cron/daily`
Expected: PASS (domain behaviour unchanged; the existing `daily-sweep.test.ts` still green).
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/features/automation/application/owner-resolver.ts src/features/automation/application/owner-resolver.test.ts src/app/api/cron/daily/route.ts
git commit -m "perf(automation): resolve owners once per org and skip owner-less orgs safely"
```

---

### Task 15: Trim the heaviest list pages

**In plain terms:** A few pages fetch entire tables and do work the database should do. The Tasks page pulls every task and filters in JavaScript; the Evidence page rebuilds a giant control picker inside every card. We push the Tasks filter into the query and cap the biggest lists so they stay fast as data grows.

**Files:**
- Modify: `src/app/app/tasks/page.tsx:13-19`
- Modify: `src/app/app/evidence/page.tsx:14,40`
- Modify: `src/app/app/risks/page.tsx:16`

- [ ] **Step 1: Push the Tasks status filter into SQL**

In `tasks/page.tsx`, the `filter` searchParam is applied in JS (line 16). Keep the JS derivation for the "overdue" case (it depends on today), but let the database do status filtering. Change the query (line 13) to conditionally add a status filter, and keep the unfiltered counts from a separate head-count query so the stat tiles stay correct:
```tsx
  const statusFilter = filter === "open" || filter === "in_progress" || filter === "done" || filter === "cancelled" ? filter : null;
  let query = supabase.from("tasks").select("id,title,detail,status,due_on,recurrence,source,owner_id,profiles:owner_id(display_name)")
    .order("due_on", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(500);
  if (statusFilter) query = query.eq("status", statusFilter);
  const { data } = await query;
```
Leave the `overdue`/`all` handling in JS as-is (lines 16), and keep computing `openCount`/`overdueCount`/`recurringCount` — but source those three counts from a small dedicated head-count set rather than the (now possibly filtered) `data`. Add above the query:
```tsx
  const [{ count: openCount }, { count: overdueCount }] = await Promise.all([
    supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
    supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]).not("due_on", "is", null).lt("due_on", today),
  ]);
```
Then delete the JS `openCount`/`overdueCount` lines (17–18) and adjust `recurringCount` to a head count too, or drop it from the tiles if not worth a query. Use `openCount ?? 0` etc. in the `<Stat>`s.

- [ ] **Step 2: Hoist the Evidence link-picker options and cap the list**

In `evidence/page.tsx`, the `<select>` at line 40 renders the full `controls` + `policies` option list inside **every** evidence card (O(cards × options)). Extract the options once, above the `return`:
```tsx
  const linkOptions = (
    <>
      {controls?.map((c) => <option key={c.id} value={`control:${c.id}`}>{c.code}: {c.title}</option>)}
      <optgroup label="Policies">{policies?.map((p) => <option key={p.id} value={`policy:${p.id}`}>{p.reference}: {p.title}</option>)}</optgroup>
    </>
  );
```
Then in the card's `<select>` (line 40), replace the inline `.map`s with `{linkOptions}`. Also add `.limit(200)` to the evidence query (line 14) so a huge vault doesn't render unbounded.
> React note: the same element reference can be reused across many `<select>`s — React re-renders it per parent; this removes the repeated `.map` allocation and keeps the markup identical.

- [ ] **Step 3: Cap the Risks list**

In `risks/page.tsx:16`, add `.limit(500)` to the `risks` select. (The gap-suggestions query at line 17 is already `.limit(10)`.)

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test -- src/app/app/tasks`
Expected: PASS. Manually confirm the Tasks filters still work (open/in_progress/done/cancelled/overdue/all) and the Evidence cards still show the picker.

- [ ] **Step 5: Commit**

```bash
git add src/app/app/tasks/page.tsx src/app/app/evidence/page.tsx src/app/app/risks/page.tsx
git commit -m "perf(lists): push task filter to SQL, hoist evidence picker, cap large lists"
```

---

### Task 16: Externalize heavy server-only libraries

**In plain terms:** Two document-generation libraries only ever run on the server. Telling Next not to bundle them speeds up builds and cold starts. One-line config change.

**Files:**
- Modify: `next.config.ts:30`

- [ ] **Step 1: Add the packages**

Change:
```ts
  serverExternalPackages: ["pdfkit"],
```
to:
```ts
  serverExternalPackages: ["pdfkit", "exceljs", "docx"],
```

- [ ] **Step 2: Verify the exports still work**

Run: `npm run build`
Expected: build succeeds.
Manual: download an XLSX export (`/api/app/risks/export?format=xlsx`), a DOCX and a PDF (`/api/app/soa/[snapshotId]/[format]` and the readiness PDF) — all still generate.

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "perf(build): keep exceljs and docx server-external"
```

---

# Workstream D — Cleanup

### Task 17: One package manager (npm)

**In plain terms:** The project ships two competing lockfiles, so different machines/CI can install different versions. We commit to npm — the manager your notes already assume — and remove the pnpm files so installs are deterministic.

**Files:**
- Delete: `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- Modify: `package.json` (the `verify` script + add `packageManager`)
- Check: `.github/**` for pnpm references

- [ ] **Step 1: Confirm nothing needs the pnpm workspace file**

Run: `cat pnpm-workspace.yaml` and `grep -rin "pnpm" .github package.json vercel.json`
Expected: `pnpm-workspace.yaml` only holds a build-allowlist (e.g. `sharp`, which isn't even a dependency — confirm with `grep '"sharp"' package.json` returning nothing). If CI (`.github/workflows/*`) invokes pnpm, note the files to update in Step 3.

- [ ] **Step 2: Delete the pnpm files**

Run:
```bash
git rm pnpm-lock.yaml pnpm-workspace.yaml
```

- [ ] **Step 3: Fix `package.json` and any CI**

In `package.json`, change the `verify` script from pnpm to npm:
```json
"verify": "npm run lint && npm run typecheck && npm test && npm run build",
```
Add a `packageManager` field pinned to the local npm version — get it with `npm -v` and insert (example if `npm -v` prints `10.9.0`):
```json
"packageManager": "npm@10.9.0",
```
If Step 1 found pnpm in `.github/workflows/*`, switch those steps to `npm ci` / `npm run …`.

- [ ] **Step 4: Verify a clean install + verify pipeline**

Run: `rm -rf node_modules && npm ci && npm run verify`
Expected: install resolves from `package-lock.json`; lint, typecheck, tests, and build all pass. (E2E stays out of `verify`; run `npm run test:e2e -- --workers=1` separately when needed.)

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: standardize on npm, remove pnpm lockfile and workspace"
```

---

### Task 18: Extract the duplicated cron-auth check

**In plain terms:** The same security check is copy-pasted in three cron files. We move it to one shared file so there's a single place to trust and maintain.

**Files:**
- Create: `src/lib/security/cron-auth.ts`
- Test: `src/lib/security/cron-auth.test.ts`
- Modify: `src/app/api/cron/daily/route.ts`, `integrations-sync/route.ts`, `evidence-collect/route.ts`

**Interfaces:**
- Produces: `isAuthorisedCron(request: Request): boolean` — timing-safe `Bearer ${CRON_SECRET}` comparison; `false` when the secret is unset.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/security/cron-auth.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { isAuthorisedCron } from "./cron-auth";

const req = (auth?: string) => new Request("http://x", auth ? { headers: { authorization: auth } } : undefined);
afterEach(() => vi.unstubAllEnvs());

describe("isAuthorisedCron", () => {
  it("accepts the exact bearer secret and rejects others", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(isAuthorisedCron(req("Bearer s3cret"))).toBe(true);
    expect(isAuthorisedCron(req("Bearer nope"))).toBe(false);
    expect(isAuthorisedCron(req())).toBe(false);
  });
  it("rejects everything when the secret is unset", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(isAuthorisedCron(req("Bearer anything"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/lib/security/cron-auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement (moved verbatim from the routes)**

```ts
// src/lib/security/cron-auth.ts
import { timingSafeEqual } from "node:crypto";

export function isAuthorisedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/lib/security/cron-auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Replace the three copies**

In each of `daily/route.ts`, `integrations-sync/route.ts`, `evidence-collect/route.ts`: delete the local `authorised` function and its `timingSafeEqual` import, add `import { isAuthorisedCron } from "@/lib/security/cron-auth";`, and change the guard from `if (!authorised(request))` to `if (!isAuthorisedCron(request))`.

- [ ] **Step 6: Verify + commit**

Run: `npm run typecheck && npm test -- src/app/api/cron`
Expected: PASS.
```bash
git add src/lib/security/cron-auth.ts src/lib/security/cron-auth.test.ts src/app/api/cron
git commit -m "refactor(security): single source for cron authorisation"
```

---

### Task 19: Extract the Supabase join-normalizer helper

**In plain terms:** Supabase sometimes returns a joined row as an object, sometimes as a one-item array, so the code repeats `Array.isArray(x) ? x[0] : x` in ~15 places. We give it one named helper and use it everywhere, so the intent is obvious and the pattern lives in one place.

**Files:**
- Create: `src/lib/supabase/one.ts`
- Test: `src/lib/supabase/one.test.ts`
- Modify (replace inline copies): `src/lib/app-context.ts`, `src/app/app/layout.tsx`, `src/app/app/page.tsx`, `src/app/app/risks/page.tsx`, `src/app/app/evidence/page.tsx`, `src/app/app/tasks/page.tsx`, `src/app/app/settings/page.tsx`, and the export routes' local `one()` (e.g. `src/app/api/app/risks/export/route.ts:6`).

**Interfaces:**
- Produces: `one<T>(value: T | T[] | null | undefined): T | null` — returns the first element of an array, the value itself if not an array, or `null` when empty/nullish.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/supabase/one.test.ts
import { describe, expect, it } from "vitest";
import { one } from "./one";

describe("one", () => {
  it("normalizes Supabase embedded relations", () => {
    expect(one([{ id: "a" }, { id: "b" }])).toEqual({ id: "a" });
    expect(one({ id: "a" })).toEqual({ id: "a" });
    expect(one([])).toBeNull();
    expect(one(null)).toBeNull();
    expect(one(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/lib/supabase/one.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/supabase/one.ts
export function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value.length > 0 ? value[0] : null;
  return value ?? null;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test -- src/lib/supabase/one.test.ts`
Expected: PASS.

- [ ] **Step 5: Replace inline copies incrementally**

Replace each `Array.isArray(x) ? x[0] : x` with `one(x)` (add the import `import { one } from "@/lib/supabase/one";`). Do this a few files at a time, running `npm run typecheck` after each, since the inline copies sometimes assumed non-null (`one` returns `T | null`, so adjust the immediate usage to handle null — most sites already use optional chaining like `?.name`). Start with `app-context.ts` and `layout.tsx`, then the pages, then delete the local `one()` in the export routes and import the shared one.

- [ ] **Step 6: Verify + commit**

Run: `npm run typecheck && npm test`
Expected: PASS.
```bash
git add src/lib/supabase/one.ts src/lib/supabase/one.test.ts src/lib/app-context.ts src/app
git commit -m "refactor(supabase): single one() helper for embedded relations"
```

---

## Final verification (after all tasks)

- [ ] Run the full pipeline: `npm run verify` → lint, typecheck, unit tests, build all pass.
- [ ] Run E2E for touched flows: `npm run test:e2e -- --workers=1`.
- [ ] Manual smoke: sign in → sidebar shows 11 doors + Dashboard; each nested pair (Risks/Assets, SoA/Frameworks, Audits/Activity, Settings/Connections) works via its tab strip; no UI text says "the daily sweep"/"the automation"; onboarding checklist reads Assessment → SoA → Risks → Evidence → Policy → Team; the empty Leadership report nudges toward an assessment.
- [ ] Confirm `vercel.json` has one cron and the daily run returns `{ collect, sync, sweep }`.

## Spec coverage map (self-review)

| Spec item | Task |
|---|---|
| A1 11-door sidebar | 2 |
| A2 single title source | 2 |
| A3 tab strips (JC-1) | 1, 3, 4, 5, 6 |
| A4 delete Notifications page | 2 |
| A5 checklist order | 7 |
| A6 report empty state | 8 |
| B1 de-personify copy | 9 |
| B2 one nightly pipeline (JC-2) | 10 |
| B3 Integrations→Settings | 6, 11 |
| C1 cache auth | 12 |
| C2 autosave fix | 13 |
| C3 sweep scale/safety | 14 (batching deferred — noted) |
| C4 trim list pages | 15 |
| C5 serverExternalPackages | 16 |
| D1 one package manager (JC-3) | 17 |
| D2 extract helpers | 18, 19 |
