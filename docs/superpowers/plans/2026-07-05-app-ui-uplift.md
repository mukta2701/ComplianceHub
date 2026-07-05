# App UI Uplift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the existing demo design language (dark sidebar shell, stat cards, status pills, page intros, dense data tables) to every authenticated `/app/*` page, and make the Phase 1 automation loop visible on the dashboard — with zero behavioural change.

**Architecture:** A new server-fed, client-toggle `AppShell` (the product twin of `DemoShell`) wraps `/app/layout.tsx` and owns the single `<main className="content">` landmark and the page-title `<h1>`; every `/app` page becomes a fragment that reuses the shared classes in `globals.css` and the components in `src/components/ui.tsx`/`icons.tsx`. The AA-tuned contrast overrides currently trapped in `demo.css` are relocated into `globals.css` so both shells inherit them. Nothing under `src/features/**`, no server action, no migration, and no RLS policy changes.

**Tech Stack:** Next.js 16 (App Router, server components + a single client shell), React 19, Tailwind v4 + the hand-authored design system in `src/app/globals.css`, Playwright + axe, vitest, pgTAP.

## Global Constraints

- **Presentation-only.** No changes to `src/features/**`, server actions (`src/app/app/**/actions.ts`, `src/app/(auth)/actions.ts`), Supabase migrations, seed, or RLS. The **only** data-layer latitude: a page's *own* inline `.select(...)` may read an **already-existing** column it doesn't yet read, and only where a spec-required label needs it (specifically the dashboard needs-attention queue reading `tasks.source`). No new tables, RPCs, or query modules.
- **Reuse tokens; never invent colours.** All colour comes from the existing CSS custom properties and classes (`--ink/--text/--muted/--line/--bg/--blue/--blue-pale/--green/--amber/--red/--violet`, `.pill[.green|.amber|.red|.critical|.neutral]`, `.stat-icon[.green|.amber|.red]`, `td.overdue`). The AA-contrast override block is **relocated** from `demo.css` to `globals.css` in Task 1 — do not duplicate or re-tune values.
- **Single landmark + single h1 per page.** `AppShell` renders the only `<main className="content">` and the only page-title `<h1>` (derived from the route). Every `/app` page returns a **fragment** (no `<main>`, no page-title `<h1>` of its own; section/item headings are `<h2>`/`<h3>`). This keeps axe's `landmark-*` and `page-has-heading-one` rules green.
- **en-GB copy, dense single-line component/CSS style** matching the existing files (see `src/app/demo/tasks/page.tsx`).
- **Environment (this machine):**
  - `pnpm` is **not** on `PATH`. Run every tool via `npx <tool>` or `./node_modules/.bin/<tool>`. `package.json` scripts that call `pnpm` and `playwright.config.ts`'s `webServer.command: "pnpm dev"` are **not** usable directly.
  - Playwright has `reuseExistingServer: true` (non-CI). **Before running Playwright, start the dev server yourself:** `./node_modules/.bin/next dev` (background) and wait for `http://127.0.0.1:3000`. Playwright then reuses it instead of running `pnpm dev`.
  - Local Supabase stack runs at `127.0.0.1:54321`. The schema is **untouched** by this plan, so pgTAP runs against the already-migrated DB — run `npx supabase test db` **without** `npx supabase db reset` (reset is unreliable here due to dual Docker runtimes).
  - `.env.local` provides `CRON_SECRET` (used by `e2e/phase1.spec.ts`) and `NEXT_PUBLIC_SITE_URL`.
- **Conventional commits, the configured Git author, NO co-author trailer.** The pre-commit privacy hook has known false positives; `git commit --no-verify` is permitted **only** when a commit is blocked with zero genuine findings.
- **Work in this working directory on branch `phase-a-ui-uplift`** (created in Task 1). No separate worktree.

### E2E selector contract — these visible strings, roles, labels, and structures MUST survive verbatim

From `e2e/product.spec.ts` and `e2e/phase1.spec.ts` (do not change unless a step here says so; if a structural change genuinely breaks one, adjust the **spec** minimally in Task 8 — never weaken accessibility):

- **Auth + onboarding (light-touch task 7):** labels `Name`, `Email`, `Password` (exact), `Confirm password`, `Organisation name`; buttons `Create account`, `Sign in`, `Create workspace`; headings `Create your organisation`.
- **Workspace nav:** a `role="navigation"` with accessible name **`Workspace`** containing `role="link"` items whose exact names include **`Assessment`**, **`Tasks`**, **`Evidence`** (and Dashboard, Risks, SoA, Notifications, Activity, Settings). `phase1.spec.ts` `openSection()` clicks the link by exact name and waits for `"/app/" + name.toLowerCase()` — so link name **Tasks**→`/app/tasks`, **Evidence**→`/app/evidence`, **Assessment**→`/app/assessment`.
- **Dashboard:** heading **`Readiness dashboard`**; visible text **`Open tasks`** and **`Evidence items`**; heading **`Needs attention`**.
- **Tasks:** link **`New task`**; button **`Add starter calendar`**; visible text `Review user access rights`, `Test backup restoration`; a real table so `getByRole("row", { name: /<task title>/ })` resolves; inside each row a `role="combobox"` (status select) and a button **`Save`**; textbox **`Title`** (exact) and label **`Due date`** on the new-task form; button **`Create task`**; the word **`Overdue`** rendered for overdue rows.
- **Task detail:** a `<dl>` of `<dt>label</dt><dd>value</dd>` pairs with dt text **`Owner`**, **`Due date`**, **`Source`**, **`Linked control`**; `Source` dd renders `gap`; `Linked control` dd starts `CH-\d{3}:`; a task title link that navigates to `/app/tasks/<uuid>`.
- **Evidence:** link **`Add evidence`**; each item is a `<section>` whose heading is the item **title**; inside it the exact text **`current`** / **`expiring`** / **`expired`** (a Pill), a select with accessible name **`Link <title> to a control`**, and a button **`Link`** (exact); a `<span>` showing the linked control text `CH-001:` etc.; on the new-evidence form: textbox **`Title`** (exact), label **`Kind`**, label matching **`/^URL/`**, label **`Owner`**, label **`Valid until`**, button **`Save evidence`**.
- **Risks:** link **`Accept as task`**; textbox **`Title`** (exact) and **`Detail`** (exact) + label **`Owner`** + label **`Due date`** + button **`Create task`** on the from-gap form (reached from Risks).
- **SoA:** `select[name="assessmentId"]`; button **`Generate draft`**; a link matching **`/1 open task/`** whose ancestor `<form>` contains a heading.
- **Assessment:** button **`New assessment`**; the detail page renders exactly **10** `role="combobox"` answer selects and the plain text `saved`/`error` (all owned by the untouched `AssessmentResponseList` component — do not modify it).
- **Automation:** after the cron sweep, `/app/tasks` shows exact text `Replace stale evidence: <title>` and `/app/notifications` shows the expiry message; `/app/tasks` and `/app/evidence` must pass axe with **zero** violations.

---

### File map

- **Create** `src/components/app-shell.tsx` — client shell (sidebar nav, mobile drawer toggle, header with bell + avatar + sign-out).
- **Modify** `src/components/icons.tsx` — add a `bell` glyph.
- **Modify** `src/app/globals.css` — relocate the AA-contrast override block here (append); add a handful of app-only helpers (`.app-form`, `.notif-list`, `.quick-actions`).
- **Modify** `src/app/demo/demo.css` — remove the relocated block (keep only the drawer/confirm rules).
- **Modify** `src/app/app/layout.tsx` — fetch shell data, render `AppShell`.
- **Modify** every page under `src/app/app/**` — fragment conversion (Task 1) then interior restyle (Tasks 2–7).
- **Modify** `src/app/(auth)/layout.tsx`, `sign-in/page.tsx`, `sign-up/page.tsx` — light restyle.
- **Modify** `e2e/phase1.spec.ts` — add the needs-attention assertion (Task 2) and any minimal `openSection` reconciliation (Task 8).

---

### Task 1: Branch, AppShell, CSS relocation, and fragment sweep

Stand up the product shell around every `/app` page and make the AA tokens global. After this task the app already looks like a product (dark sidebar, header, content frame) even though page interiors are not yet restyled; axe on `/app/tasks` and `/app/evidence` stays green and every existing e2e passes.

**Files:**
- Create branch `phase-a-ui-uplift`
- Create: `src/components/app-shell.tsx`
- Modify: `src/components/icons.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/app/demo/demo.css`
- Modify: `src/app/app/layout.tsx`
- Modify (fragment sweep): `src/app/app/page.tsx`, `tasks/page.tsx`, `tasks/new/page.tsx`, `tasks/[id]/page.tsx`, `tasks/from-gap/page.tsx`, `evidence/page.tsx`, `evidence/new/page.tsx`, `risks/page.tsx`, `risks/new/page.tsx`, `soa/page.tsx`, `soa/[id]/page.tsx`, `assessment/page.tsx`, `assessment/[id]/page.tsx`, `notifications/page.tsx`, `activity/page.tsx`, `settings/page.tsx`, `onboarding/page.tsx`, `invitations/accept/page.tsx`

**Interfaces:**
- Produces: `AppShell({ orgName, orgInitials, userInitials, unreadCount, children })` (default export-free named export `AppShell`) rendering `<div className="app-shell"><aside className="sidebar">…</aside><div className="app-main"><header className="app-header">…</header><main className="content">{children}</main><footer className="legal">…</footer></div></div>`, plus the `role="navigation"` accessible-named **`Workspace`** consumed by every later page's e2e.

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull --ff-only 2>/dev/null; git checkout -b phase-a-ui-uplift
```

Expected: `Switched to a new branch 'phase-a-ui-uplift'`.

- [ ] **Step 2: Add the `bell` icon**

In `src/components/icons.tsx`, add one entry to the `paths` record (after the `lock:` line):

```tsx
    bell: <><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/></>,
```

- [ ] **Step 3: Relocate the AA-contrast overrides into `globals.css`**

The overrides that make `.app-shell`, `.pill.amber/.red`, and `.data-table-wrap th` pass WCAG AA currently live **only** in `demo.css` (loaded by the demo layout). `/app` uses `.app-shell` too, so move them global.

In `src/app/globals.css`, **append** after the final line (`.ring small,.preview-stats span{color:#5d6675}`):

```css
/* Shared AA-contrast overrides (used by both AppShell and DemoShell). */
.app-shell{--blue:#2456c4;--muted:#5f6878}
.sidebar-foot .demo-pill{color:#704d00}
.sidebar-foot p,.header-actions,.legal,.page-intro p,.eyebrow,.stat small,.stat p{color:#596273}
.data-table-wrap th{color:#596273}
.pill.amber,.pill.medium{color:#715500}
.pill.red,.pill.high{color:#963f00}
```

In `src/app/demo/demo.css`, **delete** the block from `/* Compact demo metadata still meets WCAG AA at its rendered font sizes. */` through the `.pill.red,.pill.high{color:#963f00}` line (lines 3–9), leaving only the first line (`.drawer textarea{…}.confirm-backdrop{…}.confirm{…}`). The demo still inherits the overrides from `globals.css`.

- [ ] **Step 4: Write `AppShell`**

Create `src/components/app-shell.tsx`. It mirrors `DemoShell`'s toggle/drawer/escape behaviour and CSS classes, swaps in the real module nav (accessible name **`Workspace`**), the org name/initials + user initials from props, a notification **bell** link with unread count, and a sign-out form (importing the existing server action into this client component is supported):

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { signOutAction } from "@/app/app/actions";

const nav = [
  ["/app", "home", "Dashboard"],
  ["/app/assessment", "clipboard", "Assessment"],
  ["/app/risks", "alert", "Risks"],
  ["/app/soa", "file", "SoA"],
  ["/app/tasks", "check", "Tasks"],
  ["/app/evidence", "file", "Evidence"],
  ["/app/notifications", "bell", "Notifications"],
  ["/app/activity", "clipboard", "Activity"],
  ["/app/settings", "settings", "Settings"],
] as const;

const TITLES: Array<[string, string]> = [
  ["/app/assessment", "Assessment"], ["/app/risks", "Risk register"], ["/app/soa", "Statement of Applicability"],
  ["/app/tasks", "Tasks"], ["/app/evidence", "Evidence vault"], ["/app/notifications", "Notifications"],
  ["/app/activity", "Activity"], ["/app/settings", "Settings"], ["/app/onboarding", "Workspace setup"],
  ["/app/invitations", "Invitation"], ["/app", "Dashboard"],
];

function isActive(path: string, href: string) { return href === "/app" ? path === "/app" : path === href || path.startsWith(`${href}/`); }

export function AppShell({ orgName, orgInitials, userInitials, unreadCount, children }: { orgName: string; orgInitials: string; userInitials: string; unreadCount: number; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const firstNav = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!open) return;
    firstNav.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); menuButton.current?.focus(); } };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  const title = TITLES.find(([href]) => isActive(path, href))?.[1] ?? "ComplianceHub";
  return <div className="app-shell">
    <button className="nav-overlay" data-open={open} onClick={() => setOpen(false)} aria-label="Close navigation" />
    <aside className="sidebar" id="app-navigation" data-open={open} aria-label="Workspace navigation">
      <Link className="brand" href="/app" onClick={() => setOpen(false)}><span className="brand-mark"><Icon name="shield" /></span><span>ComplianceHub</span></Link>
      <div className="workspace"><span className="avatar">{orgInitials}</span><span><b>{orgName}</b><small>Workspace</small></span><Icon name="arrow" /></div>
      <nav aria-label="Workspace">{nav.map(([href, icon, label], index) => <Link ref={index === 0 ? firstNav : undefined} key={href} href={href} className={isActive(path, href) ? "active" : ""} aria-current={isActive(path, href) ? "page" : undefined} onClick={() => setOpen(false)}><Icon name={icon} />{label}</Link>)}</nav>
      <div className="sidebar-foot"><form action={signOutAction}><button className="button secondary" style={{ width: "100%" }}>Sign out</button></form><p>ComplianceHub supports readiness management. It does not provide ISO certification or legal advice.</p></div>
    </aside>
    <div className="app-main">
      <header className="app-header"><button ref={menuButton} className="menu" onClick={() => setOpen(value => !value)} aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="app-navigation"><Icon name="menu" /></button><h1>{title}</h1><div className="header-actions"><Link href="/app/notifications" className="notif-bell" aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}><Icon name="bell" />{unreadCount > 0 && <span className="notif-count">{unreadCount}</span>}</Link><span className="user-avatar">{userInitials}</span></div></header>
      <main className="content">{children}</main>
      <footer className="legal">ComplianceHub supports readiness management. It does not provide ISO certification or legal advice.</footer>
    </div>
  </div>;
}
```

- [ ] **Step 5: Add the bell helper CSS**

In `src/app/globals.css`, append (after the relocated block from Step 3):

```css
.notif-bell{position:relative;display:grid;place-items:center;width:36px;height:36px;border-radius:9px;color:#4a5costrepl}
```

Replace that placeholder line with the real rule (copy exactly):

```css
.notif-bell{position:relative;display:grid;place-items:center;width:36px;height:36px;border-radius:9px;color:#4a556a}.notif-bell:hover{background:#f2f4f8}.notif-count{position:absolute;top:-3px;right:-3px;min-width:16px;height:16px;padding:0 4px;border-radius:99px;background:var(--blue);color:#fff;font-size:9px;font-weight:800;display:grid;place-items:center}
```

- [ ] **Step 6: Rewrite `src/app/app/layout.tsx` to render `AppShell`**

```tsx
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

function initials(text: string): string {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "CH";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");
  const [{ count: unread }, { data: membership }, { data: profile }] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
    supabase.from("memberships").select("organisations(name)").limit(1).maybeSingle(),
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
  ]);
  const organisation = membership ? (Array.isArray(membership.organisations) ? membership.organisations[0] : membership.organisations) : null;
  const orgName = organisation?.name ?? "Your workspace";
  const displayName = profile?.display_name ?? user.email ?? "Member";
  return <AppShell orgName={orgName} orgInitials={initials(orgName)} userInitials={initials(displayName)} unreadCount={unread ?? 0}>{children}</AppShell>;
}
```

- [ ] **Step 7: Fragment sweep — strip the outer `<main>` from every `/app` page**

For each file in the fragment-sweep list above, replace the page's **outer** wrapper element with a fragment, leaving all inner JSX unchanged. Concretely, for every `src/app/app/**` page component: change the opening `<main className="mx-auto max-w-…">` to `<>` and its matching closing `</main>` to `</>`. Examples of the exact opening tags to replace with `<>`:

- `src/app/app/page.tsx`: `<main className="mx-auto max-w-6xl px-6 py-12">`
- `src/app/app/tasks/page.tsx`, `evidence/page.tsx`, `risks/page.tsx`: `<main className="mx-auto max-w-6xl px-6 py-10">`
- `src/app/app/tasks/new/page.tsx`, `tasks/[id]/page.tsx`, `tasks/from-gap/page.tsx`, `evidence/new/page.tsx`: `<main className="mx-auto max-w-3xl px-6 py-10">`
- `src/app/app/soa/page.tsx`, `soa/[id]/page.tsx`, `assessment/page.tsx`: `<main className="mx-auto max-w-5xl px-6 py-10">`
- `src/app/app/assessment/[id]/page.tsx`: `<main className="mx-auto max-w-4xl px-6 py-10">`
- `src/app/app/notifications/page.tsx`: `<main className="mx-auto max-w-4xl px-6 py-10">`
- `src/app/app/activity/page.tsx`: `<main className="mx-auto max-w-5xl px-6 py-10">`
- `src/app/app/settings/page.tsx`: `<main className="mx-auto max-w-3xl px-6 py-10">`
- `src/app/app/onboarding/page.tsx`: `<main className="mx-auto max-w-xl px-6 py-16">`
- `src/app/app/invitations/accept/page.tsx`: `<main className="mx-auto max-w-xl px-6 py-16">`
- `src/app/app/risks/new/page.tsx`: open the file and replace whatever its single outer `<main …>`/`</main>` wrapper is with `<>`/`</>`.

Do **not** touch `src/app/(auth)/**` (separate layout, handled in Task 7). Leave every inner heading, form, label, and button exactly as-is in this task — interiors are restyled later.

- [ ] **Step 8: Verify lint, types, build, and the full e2e gate**

Start the dev server yourself, then run the suites that exercise the shell and axe:

```bash
./node_modules/.bin/next dev &          # wait for http://127.0.0.1:3000 to answer
npx eslint . && npx tsc --noEmit && npx next build
npx playwright test e2e/product.spec.ts e2e/phase1.spec.ts
```

Expected: eslint/tsc/build clean; both specs PASS on **chromium and mobile** (axe green on `/app/tasks` and `/app/evidence`; `openSection` still reaches Tasks/Evidence; auth + workspace-creation flow unaffected). If the mobile project's `openSection` cannot reach an off-canvas nav link, note it and fix it in Task 8 (do not weaken the nav).

- [ ] **Step 9: Commit**

```bash
git add src/components/app-shell.tsx src/components/icons.tsx src/app/globals.css src/app/demo/demo.css src/app/app
git commit -m "feat: wrap the authenticated app in a product shell and globalise AA tokens"
```

---

### Task 2: Dashboard uplift — readiness ring, stat row, needs-attention centrepiece

Rebuild `/app` interior with the demo design language and make automation visible: a stat row, and the **needs-attention queue** as the centrepiece with per-row **source labels**. Keep the exact data logic; add `tasks.source` to the page's own existing control select (the one data latitude allowed by the global constraints) so overdue-task rows can be labelled.

**Files:**
- Modify: `src/app/app/page.tsx`
- Modify: `e2e/phase1.spec.ts` (add the needs-attention region assertion required by spec §6)

**Interfaces:**
- Consumes: `requireAppContext`, `isOverdue`, `TaskStatus`, `Card`, `PageIntro`, `Pill`, `Ring`, `Stat`, `Icon`, `acceptCalendarSeedAction` from `@/app/app/tasks/actions`.
- Produces: heading **`Readiness dashboard`** (via `PageIntro`), visible text **`Open tasks`** and **`Evidence items`**, heading **`Needs attention`**.

- [ ] **Step 1: Rewrite `src/app/app/page.tsx`**

```tsx
import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { isOverdue, type TaskStatus } from "@/features/tasks/domain/tasks";
import { Card, PageIntro, Pill, Ring, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
import { acceptCalendarSeedAction } from "./tasks/actions";

const STALE_EVIDENCE = new Set(["expired", "withdrawn", "superseded"]);
const SOURCE_LABEL: Record<string, string> = { gap: "From assessment gap", evidence_expiry: "Raised by daily sweep", system: "From compliance calendar", policy_review: "From policy review", manual: "Added manually" };

export default async function AppHome() {
  const { supabase, organisation } = await requireAppContext();
  const today = new Date().toISOString().slice(0, 10);
  const [{ count: assessments }, { count: risks }, { count: snapshots }, { count: openTasks }, { count: overdue }, { count: liveEvidence }, { count: expiring }, { data: controls }] = await Promise.all([
    supabase.from("assessment_sessions").select("id", { count: "exact", head: true }),
    supabase.from("risks").select("id", { count: "exact", head: true }).neq("status", "closed"),
    supabase.from("soa_snapshots").select("id", { count: "exact", head: true }),
    supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
    supabase.from("tasks").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]).not("due_on", "is", null).lt("due_on", today),
    supabase.from("evidence").select("id", { count: "exact", head: true }).in("status", ["current", "expiring", "expired"]),
    supabase.from("evidence").select("id", { count: "exact", head: true }).in("status", ["expiring", "expired"]),
    supabase.from("controls").select("id,code,title,evidence_links(evidence_id,evidence(status)),tasks(id,status,due_on,source)"),
  ]);
  const attention = (controls ?? []).flatMap((control) => {
    const statuses = (control.evidence_links ?? []).map((link) => { const ev = Array.isArray(link.evidence) ? link.evidence[0] : link.evidence; return ev?.status ?? null; });
    const staleEvidence = statuses.length > 0 && statuses.every((s) => s !== null && STALE_EVIDENCE.has(s));
    const overdueTasks = (control.tasks ?? []).filter((task) => isOverdue({ status: task.status as TaskStatus, dueOn: task.due_on }, today));
    if (!staleEvidence && overdueTasks.length === 0) return [];
    const source = staleEvidence ? "evidence_expiry" : (overdueTasks[0]?.source ?? "manual");
    const reasons: string[] = [];
    if (staleEvidence) reasons.push("linked evidence is out of date");
    if (overdueTasks.length > 0) reasons.push("a remediation task is overdue");
    return [{ id: control.id, code: control.code, title: control.title, reason: reasons.join(" and "), source: SOURCE_LABEL[source] ?? "Needs review" }];
  });
  const readiness = Math.max(0, Math.min(100, 100 - attention.length * 6));
  return <>
    <PageIntro eyebrow={organisation.name.toUpperCase()} title="Readiness dashboard" body="Your live view of open work, evidence freshness, and everything the automation is surfacing on its own." action={<Link className="button primary" href="/app/assessment">Continue assessment <Icon name="arrow" /></Link>} />
    <div className="stats-grid"><Stat label="OPEN TASKS" value={openTasks ?? 0} detail="in progress or to do" /><Stat label="OVERDUE" value={overdue ?? 0} detail="flagged by the daily sweep" tone="red" /><Stat label="EVIDENCE ITEMS" value={liveEvidence ?? 0} detail="files, links and notes" tone="green" /><Stat label="EXPIRING / EXPIRED" value={expiring ?? 0} detail="need fresh proof" tone="amber" /></div>
    <div className="dashboard-grid">
      <Card><div className="card-head"><div><h3>Needs attention</h3><p>Work the automation has surfaced — start here.</p></div><Link href="/app/tasks">All tasks</Link></div>
        {attention.length > 0 ? <div className="gap-list">{attention.slice(0, 6).map((item) => <Link key={item.id} href={`/app/soa?control=${item.id}`}><b><Icon name="alert" /></b><span><strong>{item.code}: {item.title}</strong><small>{item.reason}</small></span><Pill tone="amber">{item.source}</Pill><Icon name="arrow" /></Link>)}</div> : <p style={{ padding: "22px", color: "#596273", fontSize: "13px" }}>Nothing needs attention right now. New work will appear here as the daily sweep runs.</p>}
        <div className="card-foot"><form action={acceptCalendarSeedAction}><button className="button secondary">Add starter calendar</button></form><span className="quick-actions"><Link href="/app/evidence/new">Add evidence</Link><Link href="/app/risks">Review gaps</Link></span></div>
      </Card>
      <Card><div className="card-head"><div><h3>Overall readiness</h3><p>Signal from open work and stale evidence</p></div><Pill>Live</Pill></div><div className="readiness-body"><Ring value={readiness} /><div className="category-bars"><div><label><span>Assessments</span><b>{assessments ?? 0}</b></label></div><div><label><span>Open risks</span><b>{risks ?? 0}</b></label></div><div><label><span>Finalised SoAs</span><b>{snapshots ?? 0}</b></label></div></div></div><div className="card-foot"><span><Icon name="check" />Updated just now</span><Link href="/app/soa">Open SoA <Icon name="arrow" /></Link></div></Card>
    </div>
  </>;
}
```

- [ ] **Step 2: Add the quick-actions helper CSS**

In `src/app/globals.css`, append:

```css
.quick-actions{display:flex;gap:14px;align-items:center}.quick-actions a{color:var(--blue);font-weight:700}
```

- [ ] **Step 3: Lock the centrepiece with an e2e assertion**

`e2e/phase1.spec.ts` already asserts `getByRole("heading", { name: "Needs attention" })` at `/app` (line ~170). Strengthen it to prove the queue **region** and a source label render. Immediately after that existing line, add:

```ts
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();
  await expect(page.getByText("Raised by daily sweep").first()).toBeVisible();
```

(The stale-evidence link created earlier in the test guarantees at least one `Raised by daily sweep` row.)

- [ ] **Step 4: Verify**

```bash
./node_modules/.bin/next dev &   # if not already running
npx eslint . && npx tsc --noEmit
npx playwright test e2e/phase1.spec.ts
```

Expected: PASS on chromium and mobile; dashboard shows the ring, four stats, and the needs-attention queue with a `Raised by daily sweep` pill.

- [ ] **Step 5: Commit**

```bash
git add src/app/app/page.tsx src/app/globals.css e2e/phase1.spec.ts
git commit -m "feat: rebuild the readiness dashboard with a needs-attention automation queue"
```

---

### Task 3: Tasks pages uplift

Restyle `/app/tasks`, `tasks/new`, `tasks/[id]`, `tasks/from-gap` to the demo language while preserving every tasks selector.

**Files:**
- Modify: `src/app/app/tasks/page.tsx`, `tasks/new/page.tsx`, `tasks/[id]/page.tsx`, `tasks/from-gap/page.tsx`

**Interfaces:**
- Consumes: `PageIntro`, `Card`, `Stat`, `Pill`, `Icon`, existing task actions, `isOverdue`.
- Produces: unchanged routes and the tasks selector contract (table rows, `New task`, `Add starter calendar`, per-row combobox + `Save`, `Title`/`Due date`/`Create task`, `Overdue`).

- [ ] **Step 1: Rewrite `src/app/app/tasks/page.tsx`**

Fetch all tasks in one query (drop the server-side `.eq(status)`), filter client-side so the stat row is accurate, and render the demo table. Keep the status `combobox` with `aria-label={\`Status for ${t.title}\`}` and the `Save` button per row; keep the title as a link to `/app/tasks/${t.id}`; keep the `Add starter calendar` empty state.

```tsx
import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { isOverdue, type TaskStatus } from "@/features/tasks/domain/tasks";
import { Card, PageIntro, Pill, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
import { acceptCalendarSeedAction, updateTaskStatusAction } from "./actions";

const FILTERS = ["all", "open", "in_progress", "done", "cancelled", "overdue"] as const;
const STATUS_TONE: Record<string, string> = { open: "blue", in_progress: "amber", done: "green", cancelled: "neutral" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter = "all" } = await searchParams;
  const { supabase } = await requireAppContext();
  const { data } = await supabase.from("tasks").select("id,title,detail,status,due_on,recurrence,source,owner_id,profiles:owner_id(display_name)").order("due_on", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
  const today = new Date().toISOString().slice(0, 10);
  const all = data ?? [];
  const tasks = all.filter((t) => filter === "all" ? true : filter === "overdue" ? isOverdue({ status: t.status as TaskStatus, dueOn: t.due_on }, today) : t.status === filter);
  const openCount = all.filter((t) => t.status === "open" || t.status === "in_progress").length;
  const overdueCount = all.filter((t) => isOverdue({ status: t.status as TaskStatus, dueOn: t.due_on }, today)).length;
  const recurringCount = all.filter((t) => t.recurrence).length;
  return <>
    <PageIntro eyebrow="REMEDIATION" title="Tasks" body="Owned, dated work generated from gaps, evidence expiry and your compliance calendar." action={<Link className="button primary" href="/app/tasks/new"><Icon name="plus" />New task</Link>} />
    <div className="stats-grid"><Stat label="OPEN TASKS" value={openCount} detail="across all sources" /><Stat label="OVERDUE" value={overdueCount} detail="flagged by the daily sweep" tone="red" /><Stat label="RECURRING" value={recurringCount} detail="regenerate on completion" tone="green" /></div>
    <nav aria-label="Task filters" className="segmented" style={{ marginBottom: "16px" }}>{FILTERS.map((f) => <Link key={f} href={`/app/tasks?filter=${f}`} aria-current={filter === f ? "page" : undefined} className={filter === f ? "active" : ""} style={{ textTransform: "capitalize" }}>{f.replace("_", " ")}</Link>)}</nav>
    {!all.length && <Card style={{ padding: "20px", marginBottom: "16px" }}><h2 style={{ fontSize: "15px", margin: "0 0 4px" }}>Start with the compliance calendar</h2><p style={{ fontSize: "12px", color: "#596273", margin: "0 0 12px" }}>Add recurring access reviews, policy reviews, and backup restore tests in one click.</p><form action={acceptCalendarSeedAction}><button className="button primary">Add starter calendar</button></form></Card>}
    <Card><div className="data-table-wrap" role="region" aria-label="Tasks table" tabIndex={0}><table><thead><tr><th>Task</th><th>Owner</th><th>Due</th><th>Recurs</th><th>Source</th><th>Status</th></tr></thead><tbody>
      {tasks.map((t) => { const owner = Array.isArray(t.profiles) ? t.profiles[0] : t.profiles; const overdue = isOverdue({ status: t.status as TaskStatus, dueOn: t.due_on }, today); return <tr key={t.id}>
        <td><Link href={`/app/tasks/${t.id}`}><b>{t.title}</b></Link>{t.detail && <small>{t.detail}</small>}</td>
        <td>{owner?.display_name ?? "Unassigned"}</td>
        <td className={overdue ? "overdue" : ""}>{t.due_on ?? "—"}{overdue && <> <Pill tone="red">Overdue</Pill></>}</td>
        <td style={{ textTransform: "capitalize" }}>{t.recurrence ?? "—"}</td><td style={{ textTransform: "capitalize" }}>{t.source.replaceAll("_", " ")}</td>
        <td><form action={updateTaskStatusAction} style={{ display: "flex", gap: "6px", alignItems: "center" }}><input type="hidden" name="id" value={t.id} /><select name="status" defaultValue={t.status} aria-label={`Status for ${t.title}`} className="rounded"><option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }}>Save</button></form></td>
      </tr>; })}
      {!tasks.length && <tr><td colSpan={6} style={{ color: "#596273" }}>No tasks match this filter.</td></tr>}
    </tbody></table></div></Card>
  </>;
}
```

Note: `STATUS_TONE` is available for the detail page; it is not required in the table (kept minimal). Remove the unused const if eslint flags it, or use it in Step 3.

- [ ] **Step 2: Restyle `src/app/app/tasks/new/page.tsx`**

Wrap in `PageIntro` + a `.card` form using the `.app-form` layout. Preserve the textbox **`Title`** (exact), label **`Due date`**, and button **`Create task`**; keep every field `name` and the owner/recurrence/control/risk selects verbatim.

```tsx
import { requireAppContext } from "@/lib/app-context";
import { PageIntro } from "@/components/ui";
import { createTaskAction } from "../actions";

export default async function NewTaskPage() {
  const { supabase } = await requireAppContext();
  const [{ data: members }, { data: controls }, { data: risks }] = await Promise.all([
    supabase.from("memberships").select("user_id,profiles(display_name)"),
    supabase.from("controls").select("id,code,title").order("position"),
    supabase.from("risks").select("id,reference,title").neq("status", "closed").order("reference"),
  ]);
  return <>
    <PageIntro eyebrow="REMEDIATION" title="New task" body="Create an owned, dated action. Recurring tasks regenerate when you mark them done." />
    <form action={createTaskAction} className="card app-form">
      <label>Title<input name="title" required maxLength={200} /></label>
      <label>Detail<textarea name="detail" maxLength={10000} /></label>
      <div className="form-grid">
        <label>Owner<select name="ownerId" defaultValue=""><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label>Due date<input name="dueOn" type="date" /></label>
        <label>Recurrence<select name="recurrence" defaultValue=""><option value="">One-off</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="semiannually">Semi-annually</option><option value="annually">Annually</option></select></label>
        <label>Linked control<select name="controlId" defaultValue=""><option value="">None</option>{controls?.map((c) => <option key={c.id} value={c.id}>{c.code}: {c.title}</option>)}</select></label>
        <label>Linked risk<select name="riskId" defaultValue=""><option value="">None</option>{risks?.map((r) => <option key={r.id} value={r.id}>{r.reference}: {r.title}</option>)}</select></label>
      </div>
      <button className="button primary">Create task</button>
    </form>
  </>;
}
```

- [ ] **Step 3: Restyle `src/app/app/tasks/[id]/page.tsx`**

Keep the `<dl>`/`<dt>`/`<dd>` facts exactly (dt text `Status`, `Owner`, `Due date`, `Recurrence`, `Source`, `Linked control`, `Linked risk`; `Source` renders `task.source` e.g. `gap`; `Linked control` renders `CH-…:`), wrap in `PageIntro` + `.card`, and render status pills/linked evidence in cards. Do not change any dt/dd text or the status form.

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { isOverdue, type TaskStatus } from "@/features/tasks/domain/tasks";
import { Card, PageIntro, Pill } from "@/components/ui";
import { updateTaskStatusAction } from "../actions";

const EVIDENCE_TONE: Record<string, string> = { current: "green", expiring: "amber", expired: "red", superseded: "neutral", withdrawn: "neutral" };

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAppContext();
  const { data: task } = await supabase.from("tasks").select("id,title,detail,status,due_on,recurrence,source,owner_id,control_id,risk_id,created_at,updated_at").eq("id", id).maybeSingle();
  if (!task) notFound();
  const [{ data: owner }, { data: control }, { data: risk }, { data: evidenceLinks }] = await Promise.all([
    task.owner_id ? supabase.from("profiles").select("display_name").eq("id", task.owner_id).maybeSingle() : Promise.resolve({ data: null }),
    task.control_id ? supabase.from("controls").select("id,code,title").eq("id", task.control_id).maybeSingle() : Promise.resolve({ data: null }),
    task.risk_id ? supabase.from("risks").select("id,reference,title").eq("id", task.risk_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("evidence_links").select("id,evidence(id,title,status,kind)").eq("task_id", id),
  ]);
  const evidence = (evidenceLinks ?? []).map((l) => (Array.isArray(l.evidence) ? l.evidence[0] : l.evidence)).filter((e): e is { id: string; title: string; status: string; kind: string } => Boolean(e));
  const today = new Date().toISOString().slice(0, 10);
  const overdue = isOverdue({ status: task.status as TaskStatus, dueOn: task.due_on }, today);
  const facts: Array<[string, React.ReactNode]> = [
    ["Status", <span key="s" style={{ textTransform: "capitalize" }}>{task.status.replaceAll("_", " ")}</span>],
    ["Owner", owner?.display_name ?? "Unassigned"],
    ["Due date", <>{task.due_on ?? "—"}{overdue && <> <Pill tone="red">Overdue</Pill></>}</>],
    ["Recurrence", <span key="r" style={{ textTransform: "capitalize" }}>{task.recurrence ?? "One-off"}</span>],
    ["Source", <span key="src" style={{ textTransform: "capitalize" }}>{task.source.replaceAll("_", " ")}</span>],
    ["Linked control", control ? <Link href="/app/soa">{control.code}: {control.title}</Link> : "—"],
    ["Linked risk", risk ? <Link href="/app/risks">{risk.reference}: {risk.title}</Link> : "—"],
  ];
  return <>
    <Link href="/app/tasks" style={{ color: "var(--blue)", fontSize: "13px", fontWeight: 700 }}>← Back to tasks</Link>
    <PageIntro eyebrow="TASK" title={task.title} body="Owned, dated remediation work." />
    <Card style={{ padding: "22px" }}><dl className="fact-grid">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></Card>
    {task.detail && <Card style={{ padding: "22px", marginTop: "16px" }}><h2 style={{ fontSize: "12px", color: "#596273", margin: 0 }}>Detail</h2><p style={{ whiteSpace: "pre-wrap", marginTop: "6px" }}>{task.detail}</p></Card>}
    {evidence.length > 0 && <Card style={{ padding: "22px", marginTop: "16px" }}><h2 style={{ fontSize: "12px", color: "#596273", margin: "0 0 10px" }}>Linked evidence</h2><ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" }}>{evidence.map((e) => <li key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}><Link href="/app/evidence">{e.title}</Link><Pill tone={EVIDENCE_TONE[e.status] ?? "neutral"}>{e.status}</Pill></li>)}</ul></Card>}
    <form action={updateTaskStatusAction} className="card" style={{ padding: "18px", marginTop: "16px", display: "flex", gap: "10px", alignItems: "center" }}><input type="hidden" name="id" value={task.id} /><label style={{ fontWeight: 700, fontSize: "12px" }}>Update status <select name="status" defaultValue={task.status} style={{ marginLeft: "6px" }}><option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option><option value="cancelled">Cancelled</option></select></label><button className="button primary">Save</button></form>
  </>;
}
```

- [ ] **Step 4: Restyle `src/app/app/tasks/from-gap/page.tsx`**

Wrap in `PageIntro` + `.card.app-form`. Preserve hidden `questionId`, readonly textbox **`Title`**, textbox **`Detail`**, required **`Owner`** select, required **`Due date`**, button **`Create task`**.

```tsx
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { PageIntro } from "@/components/ui";
import { createGapTaskAction } from "../actions";

export default async function FromGapPage({ searchParams }: { searchParams: Promise<{ questionId?: string }> }) {
  const { questionId } = await searchParams;
  if (!questionId) notFound();
  const { supabase } = await requireAppContext();
  const { data: question } = await supabase.from("catalogue_questions").select("id,code,prompt,remediation").eq("id", questionId).maybeSingle();
  if (!question) notFound();
  const { data: acm } = await supabase.from("assessment_control_mappings").select("control_id").eq("catalogue_question_id", questionId).limit(1).maybeSingle();
  let control: { code: string; title: string } | null = null;
  if (acm) {
    const { data: rcm } = await supabase.from("requirement_control_mappings").select("control_id").eq("requirement_id", acm.control_id).limit(1).maybeSingle();
    if (rcm) { const { data: c } = await supabase.from("controls").select("code,title").eq("id", rcm.control_id).maybeSingle(); control = c ?? null; }
  }
  const { data: members } = await supabase.from("memberships").select("user_id,profiles(display_name)");
  const title = `Close gap: ${question.prompt}`;
  return <>
    <PageIntro eyebrow="REMEDIATION" title="Accept gap as task" body="Assign an owner and a due date. A dated, owned task is created and the gap stays visible until it is done." />
    {control && <p style={{ fontSize: "12px", color: "#596273", marginBottom: "12px" }}>Linked control: <b>{control.code}: {control.title}</b></p>}
    <form action={createGapTaskAction} className="card app-form">
      <input type="hidden" name="questionId" value={question.id} />
      <label>Title<input name="title" readOnly value={title} style={{ background: "#f6f8fb" }} /></label>
      <label>Detail<textarea name="detail" readOnly defaultValue={question.remediation} style={{ background: "#f6f8fb" }} /></label>
      <div className="form-grid">
        <label>Owner<select name="ownerId" required defaultValue=""><option value="" disabled>Select an owner</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label>Due date<input name="dueOn" type="date" required /></label>
      </div>
      <button className="button primary">Create task</button>
    </form>
  </>;
}
```

- [ ] **Step 5: Add the app-form / fact-grid helper CSS**

In `src/app/globals.css`, append:

```css
.app-form{padding:24px;display:flex;flex-direction:column;gap:16px;max-width:760px}.app-form>label,.app-form .form-grid label{display:block;font-size:12px;font-weight:700;color:#3e4758}.app-form input,.app-form select,.app-form textarea{display:block;width:100%;margin-top:6px;border:1px solid #dbe0e8;border-radius:8px;padding:9px 11px;font-size:13px;background:#fff}.app-form textarea{min-height:84px;resize:vertical}.app-form input:focus,.app-form select:focus,.app-form textarea:focus{outline:none;border-color:#7d9fea;box-shadow:0 0 0 3px #2f6bed16}.fact-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:0}.fact-grid dt{font-size:11px;color:#596273;font-weight:700}.fact-grid dd{margin:4px 0 0;font-weight:600;font-size:13px}@media(max-width:640px){.form-grid,.fact-grid{grid-template-columns:1fr}}
```

- [ ] **Step 6: Verify**

```bash
npx eslint . && npx tsc --noEmit
npx playwright test e2e/phase1.spec.ts
```

Expected: PASS on chromium + mobile (task creation, status save, gap→task, detail facts all resolve).

- [ ] **Step 7: Commit**

```bash
git add src/app/app/tasks src/app/globals.css
git commit -m "feat: restyle the tasks module in the product design language"
```

---

### Task 4: Evidence pages uplift

Restyle `/app/evidence` and `evidence/new`, preserving the evidence-item `<section>` + heading structure, freshness pills, link controls, and the new-evidence form labels.

**Files:**
- Modify: `src/app/app/evidence/page.tsx`, `evidence/new/page.tsx`

**Interfaces:**
- Consumes: `PageIntro`, `Card`, `Stat`, `Pill`, `Icon`, `summariseEvidenceFreshness`, existing evidence actions.
- Produces: unchanged routes and the evidence selector contract (`<section>` per item with title heading, `current`/`expiring`/`expired` text, `Link <title> to a control` select, `Link` button, `Add evidence` link; new-evidence `Title`/`Kind`/`URL`/`Owner`/`Valid until`/`Save evidence`).

- [ ] **Step 1: Rewrite `src/app/app/evidence/page.tsx`**

Keep each item as a `<section>` with an `<h2>` title, the status `Pill`, the link/download/supersede/withdraw controls, the linked-chip row, and the `linkEvidenceAction` form with `aria-label={\`Link ${item.title} to a control\`}` and the `Link` button. Add a `PageIntro` + stat row via `summariseEvidenceFreshness`.

```tsx
import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { summariseEvidenceFreshness, type EvidenceStatus } from "@/features/evidence/domain/evidence";
import { Card, PageIntro, Pill, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
import { downloadEvidenceAction, linkEvidenceAction, unlinkEvidenceAction, withdrawEvidenceAction } from "./actions";

const TONE: Record<string, string> = { current: "green", expiring: "amber", expired: "red", superseded: "neutral", withdrawn: "neutral" };

export default async function EvidencePage() {
  const { supabase } = await requireAppContext();
  const [{ data: items }, { data: controls }] = await Promise.all([
    supabase.from("evidence").select("id,title,kind,url,storage_path,status,collected_on,valid_until,evidence_links(id,control_id,risk_id,task_id,controls(code,title),risks(reference),tasks(title))").order("created_at", { ascending: false }),
    supabase.from("controls").select("id,code,title").order("position"),
  ]);
  const freshness = summariseEvidenceFreshness((items ?? []).map((i) => ({ status: i.status as EvidenceStatus })));
  return <>
    <PageIntro eyebrow="EVIDENCE" title="Evidence vault" body="Immutable proof attached to controls — freshness is re-checked by the daily sweep, and stale items raise tasks automatically." action={<Link className="button primary" href="/app/evidence/new"><Icon name="plus" />Add evidence</Link>} />
    <div className="stats-grid"><Stat label="EVIDENCE ITEMS" value={freshness.total} detail="files, links and notes" /><Stat label="EXPIRING SOON" value={freshness.expiring} detail="within 30 days" tone="amber" /><Stat label="EXPIRED" value={freshness.expired} detail="replacement task raised" tone="red" /></div>
    <div style={{ display: "grid", gap: "14px" }}>{items?.map((item) => <Card key={item.id} style={{ padding: "20px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
        <div><h2 style={{ fontSize: "15px", margin: 0 }}>{item.title}</h2><p style={{ fontSize: "12px", color: "#596273", margin: "3px 0 0" }}>Collected {item.collected_on}{item.valid_until && ` · valid until ${item.valid_until}`}</p></div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}><Pill tone={TONE[item.status]}>{item.status}</Pill>
          {item.kind === "link" && item.url && <a style={{ color: "var(--blue)", fontWeight: 700, fontSize: "12px" }} href={item.url} rel="noreferrer" target="_blank">Open link</a>}
          {item.kind === "file" && <form action={downloadEvidenceAction}><input type="hidden" name="id" value={item.id} /><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }}>Download</button></form>}
          {(item.status === "current" || item.status === "expiring" || item.status === "expired") && <><Link style={{ color: "var(--blue)", fontWeight: 700, fontSize: "12px" }} href={`/app/evidence/new?replaces=${item.id}`}>Supersede</Link><form action={withdrawEvidenceAction}><input type="hidden" name="id" value={item.id} /><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px", color: "var(--red)" }}>Withdraw</button></form></>}
        </div>
      </div>
      <div style={{ marginTop: "12px", display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
        {item.evidence_links?.map((link) => { const c = Array.isArray(link.controls) ? link.controls[0] : link.controls; const r = Array.isArray(link.risks) ? link.risks[0] : link.risks; const t = Array.isArray(link.tasks) ? link.tasks[0] : link.tasks; return <span key={link.id} className="pill neutral">{c ? `${c.code}: ${c.title}` : r ? `Risk ${r.reference}` : `Task: ${t?.title}`}<form action={unlinkEvidenceAction} style={{ display: "inline" }}><input type="hidden" name="linkId" value={link.id} /><button aria-label="Remove link" style={{ border: 0, background: "none", color: "#8b94a2", marginLeft: "4px" }}>×</button></form></span>; })}
        <form action={linkEvidenceAction} style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}><input type="hidden" name="evidenceId" value={item.id} /><select name="target" defaultValue="" aria-label={`Link ${item.title} to a control`} className="rounded"><option value="" disabled>Link to control…</option>{controls?.map((c) => <option key={c.id} value={`control:${c.id}`}>{c.code}: {c.title}</option>)}</select><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }}>Link</button></form>
      </div>
    </Card>)}
    {!items?.length && <Card style={{ padding: "24px", color: "#596273" }}>No evidence yet. Add your first item to start tracking freshness — files, links, or notes attach to any control, risk, or task.</Card>}
    </div>
  </>;
}
```

- [ ] **Step 2: Restyle `src/app/app/evidence/new/page.tsx`**

`PageIntro` + `.card.app-form`. Preserve textbox **`Title`**, label **`Kind`**, label matching **`/^URL/`** (keep the text starting with `URL`), label **`Owner`**, label **`Valid until`**, button **`Save evidence`**, and the `role="alert"` message block.

```tsx
import { requireAppContext } from "@/lib/app-context";
import { PageIntro } from "@/components/ui";
import { createEvidenceAction } from "../actions";

export default async function NewEvidencePage({ searchParams }: { searchParams: Promise<{ replaces?: string; message?: string }> }) {
  const { replaces, message } = await searchParams;
  const { supabase } = await requireAppContext();
  const { data: members } = await supabase.from("memberships").select("user_id,profiles(display_name)");
  return <>
    <PageIntro eyebrow="EVIDENCE" title="Add evidence" body="Attach a file, link or note. Set a valid-until date and the daily sweep will track freshness for you." />
    {message && <p role="alert" className="card" style={{ padding: "12px", borderColor: "#f0c9c9", background: "#fdf2f2", color: "#963f00", fontSize: "13px", marginBottom: "12px" }}>{message}</p>}
    <form action={createEvidenceAction} className="card app-form">
      {replaces && <input type="hidden" name="replacesEvidenceId" value={replaces} />}
      <label>Title<input name="title" required maxLength={200} /></label>
      <label>Kind<select name="kind" defaultValue="file"><option value="file">File upload</option><option value="link">Link</option><option value="note">Note</option></select></label>
      <label>File (PDF, PNG, JPG, DOCX, XLSX, CSV, TXT — max 25 MB)<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.csv,.txt" /></label>
      <label>URL (for link evidence)<input name="url" type="url" placeholder="https://" /></label>
      <label>Description<textarea name="description" maxLength={10000} /></label>
      <div className="form-grid">
        <label>Owner<select name="ownerId" defaultValue=""><option value="">Unassigned</option>{members?.map((m) => { const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles; return <option key={m.user_id} value={m.user_id}>{p?.display_name ?? m.user_id}</option>; })}</select></label>
        <label>Collected on<input name="collectedOn" type="date" /></label>
        <label>Valid until<input name="validUntil" type="date" /></label>
        <label>Review interval<select name="reviewInterval" defaultValue=""><option value="">None</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="semiannually">Semi-annually</option><option value="annually">Annually</option></select></label>
      </div>
      <button className="button primary">Save evidence</button>
    </form>
  </>;
}
```

- [ ] **Step 3: Verify**

```bash
npx eslint . && npx tsc --noEmit
npx playwright test e2e/phase1.spec.ts
```

Expected: PASS on chromium + mobile; axe green on `/app/evidence` (run inside the phase1 spec).

- [ ] **Step 4: Commit**

```bash
git add src/app/app/evidence
git commit -m "feat: restyle the evidence vault in the product design language"
```

---

### Task 5: Risks, SoA, and assessment pages uplift

**Files:**
- Modify: `src/app/app/risks/page.tsx`, `risks/new/page.tsx`, `soa/page.tsx`, `soa/[id]/page.tsx`, `assessment/page.tsx`, `assessment/[id]/page.tsx`

**Interfaces:**
- Consumes: `PageIntro`, `Card`, `Pill`, `Progress`, `Icon`, existing actions, `calculateRiskScore`, `riskBand`, `summariseEvidenceFreshness`, the untouched `AssessmentResponseList`.
- Produces: unchanged routes; preserves `Accept as task` link + `Accept as risk` button, `select[name="assessmentId"]` + `Generate draft`, the `/1 open task/` link inside a `<form>` with a heading, `New assessment` button, and the 10-combobox assessment detail.

- [ ] **Step 1: Rewrite `src/app/app/risks/page.tsx`**

Convert the table to `.data-table-wrap`, the gap-suggestion box to an amber `.card` keeping **both** `Accept as risk` (button) and `Accept as task` (link), and score/band to `Pill`s. Preserve `select[name="status"]` with `onChange` submit and the delete button.

```tsx
import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { acceptRiskSuggestionAction, deleteRiskAction, updateRiskStatusAction } from "../actions";
import { calculateRiskScore, riskBand } from "@/features/risks/domain/risks";
import { summariseEvidenceFreshness, type EvidenceStatus } from "@/features/evidence/domain/evidence";
import { Card, PageIntro, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";

const BAND_TONE: Record<string, string> = { low: "green", medium: "amber", high: "red", very_high: "critical" };

export default async function RisksPage() {
  const { supabase } = await requireAppContext();
  const [{ data }, { data: gaps }, { data: linkedTasks }, { data: evidenceLinks }] = await Promise.all([
    supabase.from("risks").select("id,reference,title,category,likelihood,impact,residual_likelihood,residual_impact,status,review_date").order("updated_at", { ascending: false }),
    supabase.from("assessment_responses").select("session_id,question_id,answer,catalogue_questions!assessment_responses_question_id_fkey(code,prompt)").in("answer", ["no", "partially"]).limit(10),
    supabase.from("tasks").select("id,title,risk_id,status").in("status", ["open", "in_progress"]).not("risk_id", "is", null),
    supabase.from("evidence_links").select("risk_id,evidence(status)").not("risk_id", "is", null),
  ]);
  const tasksByRisk = new Map<string, { id: string; title: string }[]>();
  for (const t of linkedTasks ?? []) { if (!t.risk_id) continue; const list = tasksByRisk.get(t.risk_id) ?? []; list.push({ id: t.id, title: t.title }); tasksByRisk.set(t.risk_id, list); }
  const evidenceByRisk = new Map<string, { status: EvidenceStatus }[]>();
  for (const link of evidenceLinks ?? []) { if (!link.risk_id) continue; const ev = Array.isArray(link.evidence) ? link.evidence[0] : link.evidence; if (!ev) continue; const list = evidenceByRisk.get(link.risk_id) ?? []; list.push({ status: ev.status as EvidenceStatus }); evidenceByRisk.set(link.risk_id, list); }
  return <>
    <PageIntro eyebrow="RISK" title="Risk register" body="Track inherent and residual exposure on a documented 5×5 matrix." action={<Link className="button primary" href="/app/risks/new"><Icon name="plus" />Add risk</Link>} />
    {Boolean(gaps?.length) && <Card style={{ padding: "20px", marginBottom: "16px", borderColor: "#efe1aa", background: "#fffbef" }}><h2 style={{ fontSize: "15px", margin: "0 0 4px" }}>Assessment gap suggestions</h2><p style={{ fontSize: "12px", color: "#596273", margin: 0 }}>Nothing is created until you accept it.</p>{gaps?.map((g) => { const q = Array.isArray(g.catalogue_questions) ? g.catalogue_questions[0] : g.catalogue_questions; return <div key={`${g.session_id}-${g.question_id}`} style={{ display: "flex", justifyContent: "space-between", gap: "16px", marginTop: "12px" }}><span style={{ fontSize: "13px" }}>{q?.code}: {q?.prompt}</span><span style={{ display: "flex", flexShrink: 0, gap: "16px" }}><form action={acceptRiskSuggestionAction}><input type="hidden" name="questionId" value={g.question_id} /><input type="hidden" name="sessionId" value={g.session_id} /><button style={{ color: "var(--blue)", fontWeight: 700, border: 0, background: "none" }}>Accept as risk</button></form><Link style={{ color: "var(--blue)", fontWeight: 700 }} href={`/app/tasks/from-gap?questionId=${g.question_id}`}>Accept as task</Link></span></div>; })}</Card>}
    <Card><div className="data-table-wrap" role="region" aria-label="Risk register table" tabIndex={0}><table><thead><tr><th>Ref</th><th>Risk</th><th>Inherent</th><th>Residual</th><th>Status</th><th>Review</th><th></th></tr></thead><tbody>
      {data?.map((r) => { const inherent = calculateRiskScore(r.likelihood, r.impact); const residual = calculateRiskScore(r.residual_likelihood, r.residual_impact); const linked = tasksByRisk.get(r.id) ?? []; const freshness = summariseEvidenceFreshness(evidenceByRisk.get(r.id) ?? []); return <tr key={r.id}>
        <td>{r.reference}</td>
        <td><b>{r.title}</b><small>{r.category}</small>{linked.length > 0 && <small>Linked tasks: {linked.map((t, i) => <span key={t.id}>{i > 0 && ", "}<Link href={`/app/tasks/${t.id}`}>{t.title}</Link></span>)}</small>}{freshness.total > 0 && <small>Evidence: {freshness.total}{freshness.expiring > 0 ? ` · ${freshness.expiring} expiring` : ""}{freshness.expired > 0 ? ` · ${freshness.expired} expired` : ""}</small>}</td>
        <td><Pill tone={BAND_TONE[riskBand(inherent)] ?? "neutral"}>{inherent} · {riskBand(inherent).replace("_", " ")}</Pill></td>
        <td><Pill tone={BAND_TONE[riskBand(residual)] ?? "neutral"}>{residual} · {riskBand(residual).replace("_", " ")}</Pill></td>
        <td><form action={updateRiskStatusAction}><input type="hidden" name="id" value={r.id} /><select name="status" defaultValue={r.status} onChange={(e) => e.currentTarget.form?.requestSubmit()}><option value="open">Open</option><option value="treating">Treating</option><option value="accepted">Accepted</option><option value="closed">Closed</option></select></form></td>
        <td>{r.review_date ?? "—"}</td>
        <td><form action={deleteRiskAction}><input type="hidden" name="id" value={r.id} /><button style={{ color: "var(--red)", border: 0, background: "none" }}>Delete</button></form></td>
      </tr>; })}
    </tbody></table></div></Card>
  </>;
}
```

Note: `risks/page.tsx` was a single-line file; this multi-line rewrite is equivalent. The `select` `onChange` uses `requestSubmit()` so it stays a client-capable inline handler in a server component via the form — unchanged from the original behaviour.

- [ ] **Step 2: Restyle `src/app/app/risks/new/page.tsx`**

Open the file, wrap its content in `PageIntro` + `.card.app-form`, and map its inputs to `.app-form` `<label>` fields. Preserve every field `name`, `required`, and the submit button text exactly. (No selector in the specs targets this page, so only structure/classes change.)

- [ ] **Step 3: Restyle `src/app/app/soa/page.tsx`**

Preserve `select[name="assessmentId"]`, button **`Generate draft`**, the drafts list links, and the finalised-snapshot PDF/DOCX anchors.

```tsx
import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro } from "@/components/ui";
import { createSoaAction } from "../actions";

export default async function SoaPage() {
  const { supabase } = await requireAppContext();
  const [{ data: assessments }, { data: registers }, { data: snapshots }] = await Promise.all([
    supabase.from("assessment_sessions").select("id,title").order("updated_at", { ascending: false }),
    supabase.from("soa_registers").select("id,title,version,updated_at").order("updated_at", { ascending: false }),
    supabase.from("soa_snapshots").select("id,title,version,finalised_at").order("finalised_at", { ascending: false }),
  ]);
  return <>
    <PageIntro eyebrow="SOA" title="Statement of Applicability" body="Generate a draft from an assessment, review every applicability decision, then finalise an immutable snapshot." />
    <Card style={{ padding: "16px" }}><form action={createSoaAction} style={{ display: "flex", gap: "12px" }}><select name="assessmentId" required style={{ flex: 1 }}><option value="">Select an assessment</option>{assessments?.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</select><button className="button primary">Generate draft</button></form></Card>
    <h2 style={{ fontSize: "16px", margin: "24px 0 12px" }}>Drafts</h2><Card>{registers?.length ? registers.map((r) => <Link href={`/app/soa/${r.id}`} key={r.id} style={{ display: "block", padding: "14px 18px", borderTop: "1px solid #edf0f4" }}>{r.title} <span style={{ float: "right" }}>v{r.version}</span></Link>) : <p style={{ padding: "18px", color: "#596273" }}>No drafts yet.</p>}</Card>
    <h2 style={{ fontSize: "16px", margin: "24px 0 12px" }}>Finalised snapshots</h2><Card>{snapshots?.length ? snapshots.map((s) => <div style={{ padding: "14px 18px", borderTop: "1px solid #edf0f4" }} key={s.id}>{s.title} v{s.version}<span style={{ float: "right" }}><a style={{ color: "var(--blue)", marginRight: "12px" }} href={`/api/app/soa/${s.id}/pdf`}>PDF</a><a style={{ color: "var(--blue)" }} href={`/api/app/soa/${s.id}/docx`}>DOCX</a></span></div>) : <p style={{ padding: "18px", color: "#596273" }}>No finalised snapshots yet.</p>}</Card>
  </>;
}
```

- [ ] **Step 4: Restyle `src/app/app/soa/[id]/page.tsx`**

Keep all data logic verbatim (the requirement→control task/evidence mapping). Wrap in `PageIntro` (title `{register.title}`), keep each item `<form>` with its `<h2>` heading `{control_code}: {control_title}`, the freshness badge, and the **`N open task(s)`** link (so `/1 open task/` inside a `<form>` with a heading still resolves). Only swap the outer wrappers to `.card`/`PageIntro` and the finalise button to `.button` styling; do not alter the selects, textareas, or the `openTasks` link text.

Concretely: replace the outer `<div className="flex justify-between">…</div>` intro with `<PageIntro eyebrow="SOA" title={register.title} body="Review every applicability decision and justification before finalising." action={<form action={finaliseSoaAction}><input type="hidden" name="registerId" value={id}/><button className="button primary">Finalise immutable v{register.version}</button></form>} />`, wrap the items list `<div>` unchanged, and give each item `<form className="card" style={{ padding: "20px" }}>` (was `rounded-xl border bg-white p-5`). Leave the `openTasks > 0 ? <Link …>{openTasks} open {openTasks === 1 ? "task" : "tasks"}</Link>` expression exactly as written.

- [ ] **Step 5: Restyle `src/app/app/assessment/page.tsx`**

`PageIntro` + `.card` list. Preserve button **`New assessment`** and the message block.

```tsx
import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro } from "@/components/ui";
import { createAssessmentAction } from "../actions";

export default async function AssessmentsPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { supabase } = await requireAppContext(); const { message } = await searchParams;
  const { data } = await supabase.from("assessment_sessions").select("id,title,state,revision,updated_at").order("updated_at", { ascending: false });
  return <>
    <PageIntro eyebrow="ASSESSMENT" title="Readiness assessments" body="Complete the original plain-English catalogue and retain evidence notes." action={<form action={createAssessmentAction}><button className="button primary">New assessment</button></form>} />
    {message && <Card style={{ padding: "12px", background: "#fffbef", borderColor: "#efe1aa", marginBottom: "12px" }}>{message}</Card>}
    <Card>{data?.length ? data.map((item) => <Link style={{ display: "block", padding: "16px 18px", borderTop: "1px solid #edf0f4" }} href={`/app/assessment/${item.id}`} key={item.id}><b>{item.title}</b><span style={{ float: "right", textTransform: "capitalize", color: "#596273" }}>{item.state} · revision {item.revision}</span></Link>) : <p style={{ padding: "20px", color: "#596273" }}>No assessments yet.</p>}</Card>
  </>;
}
```

- [ ] **Step 6: Restyle `src/app/app/assessment/[id]/page.tsx`**

Wrap with `PageIntro` (title `{session.title}`) and keep `<AssessmentResponseList …/>` **exactly** (it owns the 10 comboboxes and the `saved`/`error` text product.spec asserts).

```tsx
import { notFound } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { PageIntro } from "@/components/ui";
import { AssessmentResponseList } from "@/components/assessment-response-form";

export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const { supabase } = await requireAppContext();
  const { data: session } = await supabase.from("assessment_sessions").select("id,title,revision,catalogue_version_id").eq("id", id).single(); if (!session) notFound();
  const [{ data: questions }, { data: responses }] = await Promise.all([
    supabase.from("catalogue_questions").select("id,code,prompt,position").eq("catalogue_version_id", session.catalogue_version_id).order("position"),
    supabase.from("assessment_responses").select("question_id,answer,evidence_note").eq("session_id", id),
  ]);
  return <>
    <PageIntro eyebrow="ASSESSMENT" title={session.title} body="Answers save automatically. A conflict is shown rather than overwriting newer work." />
    <AssessmentResponseList sessionId={id} questions={questions ?? []} initialRevision={session.revision} responses={responses ?? []} />
  </>;
}
```

- [ ] **Step 7: Verify**

```bash
npx eslint . && npx tsc --noEmit
npx playwright test e2e/phase1.spec.ts e2e/product.spec.ts
```

Expected: PASS on chromium + mobile (SoA generate/finalise, `/1 open task/` link, gap→risk/task, assessment 10 comboboxes + autosave).

- [ ] **Step 8: Commit**

```bash
git add src/app/app/risks src/app/app/soa src/app/app/assessment
git commit -m "feat: restyle risks, SoA, and assessment in the product design language"
```

---

### Task 6: Notifications uplift + deferred aria polish

Restyle `/app/notifications` as a card list with kind icons and an unread pill, and land the notification aria polish deferred from Phase 1 (accessible names on the mark-read controls and the unread state).

**Files:**
- Modify: `src/app/app/notifications/page.tsx`

**Interfaces:**
- Consumes: `PageIntro`, `Card`, `Pill`, `Icon`, existing notification actions.
- Produces: unchanged route; preserves visible message text, `Mark all read`, and `Mark read`, plus the automation message that phase1 asserts.

- [ ] **Step 1: Rewrite `src/app/app/notifications/page.tsx`**

```tsx
import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro, Pill } from "@/components/ui";
import { Icon } from "@/components/icons";
import { markAllNotificationsReadAction, markNotificationReadAction } from "./actions";

const KIND_ICON: Record<string, string> = { evidence_expiry: "file", task_overdue: "check", assessment: "clipboard", risk: "alert", system: "bell" };

export default async function NotificationsPage() {
  const { supabase } = await requireAppContext();
  const { data } = await supabase.from("notifications").select("id,kind,message,read_at,created_at").order("created_at", { ascending: false }).limit(100);
  const unread = data?.filter((n) => !n.read_at) ?? [];
  return <>
    <PageIntro eyebrow="NOTIFICATIONS" title="Notifications" body="Automation and workspace updates. The daily sweep posts here when evidence expires or work falls overdue." action={unread.length > 0 ? <form action={markAllNotificationsReadAction}><button className="button secondary">Mark all read</button></form> : undefined} />
    <Card><ul className="notif-list" aria-label="Notifications">
      {data?.length ? data.map((n) => <li key={n.id} data-unread={!n.read_at}>
        <span className="notif-icon"><Icon name={KIND_ICON[n.kind] ?? "bell"} /></span>
        <span className="notif-body"><p>{n.message}{!n.read_at && <> <Pill>Unread</Pill></>}</p><small>{new Date(n.created_at).toLocaleString("en-GB")}</small></span>
        {!n.read_at && <form action={markNotificationReadAction}><input type="hidden" name="id" value={n.id} /><button className="button secondary" style={{ minHeight: "32px", padding: "6px 12px" }} aria-label={`Mark notification read: ${n.message}`}>Mark read</button></form>}
      </li>) : <li className="notif-empty">Nothing needs your attention. The daily sweep will post here when something changes.</li>}
    </ul></Card>
  </>;
}
```

- [ ] **Step 2: Add the notif-list helper CSS**

In `src/app/globals.css`, append:

```css
.notif-list{list-style:none;margin:0;padding:0}.notif-list li{display:flex;gap:12px;align-items:flex-start;padding:14px 18px;border-top:1px solid #edf0f4}.notif-list li:first-child{border-top:0}.notif-list li[data-unread=true]{background:#f7faff}.notif-icon{width:32px;height:32px;border-radius:9px;background:var(--blue-pale);color:var(--blue);display:grid;place-items:center;flex:none}.notif-icon svg{width:16px}.notif-body{flex:1}.notif-body p{margin:0;font-size:13px}.notif-body small{color:#596273;font-size:10.5px}.notif-empty{color:#596273;padding:20px}
```

- [ ] **Step 3: Verify**

```bash
npx eslint . && npx tsc --noEmit
npx playwright test e2e/phase1.spec.ts
```

Expected: PASS on chromium + mobile; the expired-evidence notification message still resolves.

- [ ] **Step 4: Commit**

```bash
git add src/app/app/notifications src/app/globals.css
git commit -m "feat: restyle notifications with kind icons and accessible mark-read controls"
```

---

### Task 7: Activity, settings, invitations, onboarding + auth pages

**Files:**
- Modify: `src/app/app/activity/page.tsx`, `settings/page.tsx`, `invitations/accept/page.tsx`, `onboarding/page.tsx`
- Modify: `src/app/(auth)/layout.tsx`, `sign-in/page.tsx`, `sign-up/page.tsx`

**Interfaces:**
- Consumes: `PageIntro`, `Card`, `Icon`, existing actions.
- Produces: unchanged routes; preserves onboarding heading **`Create your organisation`**, label **`Organisation name`**, button **`Create workspace`**; and all auth labels/buttons (`Name`, `Email`, `Password`, `Confirm password`, `Create account`, `Sign in`).

- [ ] **Step 1: Restyle `src/app/app/activity/page.tsx`**

`PageIntro` + `.card` list; preserve `action`/`entity_type`/`entity_id`/actor/time content.

```tsx
import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro } from "@/components/ui";

export default async function ActivityPage() {
  const { supabase } = await requireAppContext();
  const { data } = await supabase.from("audit_events").select("id,action,entity_type,entity_id,occurred_at,profiles(display_name)").order("occurred_at", { ascending: false }).limit(100);
  return <>
    <PageIntro eyebrow="AUDIT" title="Audit activity" body="Append-only record of important tenant changes." />
    <Card>{data?.length ? data.map((e) => { const profile = Array.isArray(e.profiles) ? e.profiles[0] : e.profiles; return <div style={{ padding: "14px 18px", borderTop: "1px solid #edf0f4", fontSize: "13px" }} key={e.id}><b style={{ textTransform: "capitalize" }}>{e.action}</b> {e.entity_type.replaceAll("_", " ")} <code style={{ fontSize: "11px", color: "var(--blue)" }}>{e.entity_id}</code><span style={{ float: "right", color: "#596273" }}>{profile?.display_name ?? "System"} · {new Date(e.occurred_at).toLocaleString("en-GB")}</span></div>; }) : <p style={{ padding: "20px", color: "#596273" }}>No recorded activity yet.</p>}</Card>
  </>;
}
```

- [ ] **Step 2: Restyle `src/app/app/settings/page.tsx`**

`PageIntro` + `.card`. Preserve the invite form (`email`/`role` inputs + `Create invite` button) and the invite-created panel.

```tsx
import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro } from "@/components/ui";
import { inviteMemberAction } from "../actions";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { membership, organisation } = await requireAppContext(); const { invite } = await searchParams;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return <>
    <PageIntro eyebrow="SETTINGS" title="Organisation settings" body={`${organisation.name} · your role: ${membership.role}`} />
    {invite && <Card style={{ padding: "16px", background: "#eef7f0", borderColor: "#cfe6d5", marginBottom: "16px" }}><b>Invitation created.</b><p style={{ marginTop: "8px", wordBreak: "break-all", fontSize: "13px" }}>{site}/app/invitations/accept?token={invite}</p></Card>}
    {membership.role === "owner" && <Card className="app-form" style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "12px", alignItems: "end" }}><label>Email<input type="email" name="email" required placeholder="member@example.com" form="invite-form" /></label><label>Role<select name="role" form="invite-form"><option value="member">Member</option><option value="owner">Owner</option></select></label><form id="invite-form" action={inviteMemberAction}><button className="button primary">Create invite</button></form></Card>}
    <p style={{ marginTop: "16px", fontSize: "12px", color: "#596273" }}>ComplianceHub supports readiness management. It does not provide certification or legal advice.</p>
  </>;
}
```

Note: the inputs use `form="invite-form"` so they post with the invite form while sitting in the grid; if this complicates the existing single-form layout, instead keep the original single `<form action={inviteMemberAction}>` wrapping all three fields and only swap classes — behaviour and field `name`s must stay identical either way.

- [ ] **Step 3: Restyle `src/app/app/invitations/accept/page.tsx`**

`PageIntro` + `.card`. Preserve hidden `token`, the `role="alert"` message, and the `Join organisation` button (disabled when no token).

```tsx
import { PageIntro, Card } from "@/components/ui";
import { acceptInvitationAction } from "../../actions";

export default async function AcceptInvitationPage({ searchParams }: { searchParams: Promise<{ token?: string; message?: string }> }) {
  const { token, message } = await searchParams;
  return <>
    <PageIntro eyebrow="INVITATION" title="Accept invitation" body="The invitation must match the email address on your signed-in account." />
    {message && <Card role="alert" style={{ padding: "12px", background: "#fdf2f2", borderColor: "#f0c9c9", marginBottom: "12px" }}>{message}</Card>}
    <form action={acceptInvitationAction}><input type="hidden" name="token" value={token ?? ""} /><button disabled={!token} className="button primary">Join organisation</button></form>
  </>;
}
```

- [ ] **Step 4: Restyle `src/app/app/onboarding/page.tsx`**

Full guided treatment; MUST keep heading **`Create your organisation`**, label **`Organisation name`**, button **`Create workspace`**, and the `role="alert"` message.

```tsx
import { createOrganisationAction } from "../actions";
import { PageIntro, Card } from "@/components/ui";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams;
  return <>
    <PageIntro eyebrow="WORKSPACE SETUP" title="Create your organisation" body="Assessment answers, risks, evidence and exports are isolated to this organisation." />
    {message && <Card role="alert" style={{ padding: "12px", background: "#fdf2f2", borderColor: "#f0c9c9", marginBottom: "12px" }}>{message}</Card>}
    <form action={createOrganisationAction} className="card app-form">
      <label>Organisation name<input name="name" required maxLength={160} autoFocus placeholder="Example Ltd" /></label>
      <button className="button primary">Create workspace</button>
    </form>
  </>;
}
```

- [ ] **Step 5: Light-touch auth restyle**

`src/app/(auth)/layout.tsx` → centred card on the product background with the logo:

```tsx
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main style={{ minHeight: "100vh", background: "linear-gradient(180deg,#eef2fb 0%,#f7f8fa 42%)", display: "grid", placeItems: "center", padding: "48px 24px" }}>
    <div style={{ width: "100%", maxWidth: "420px" }}>
      <Link href="/" className="brand" style={{ justifyContent: "center", marginBottom: "24px" }}><span className="brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 19 6v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6Z"/><path d="m9 12 2 2 4-4"/></svg></span>ComplianceHub</Link>
      {children}
    </div>
  </main>;
}
```

`src/app/(auth)/sign-in/page.tsx` and `sign-up/page.tsx` → change the outer `<section className="rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">` to `<section className="card" style={{ padding: "28px" }}>`, swap the dark input classes for the `.app-form`-style light inputs, and the submit `<button>` to `className="button primary"` with `style={{ width: "100%" }}`. Keep **every** `<label>` text (`Name`, `Email`, `Password`, `Confirm password`), every `name`/`type`/`autoComplete`/`minLength`/`required`, the `role="alert"`/`role="status"` message, and the `Create account` / `Sign in` button text verbatim. Wrap each in `<div className="app-form">`-equivalent styling so inputs are legible on the light card.

- [ ] **Step 6: Verify**

```bash
npx eslint . && npx tsc --noEmit
npx playwright test e2e/product.spec.ts e2e/phase1.spec.ts
```

Expected: PASS on chromium + mobile (sign-up → sign-in → create-workspace flow, settings invite, onboarding).

- [ ] **Step 7: Commit**

```bash
git add src/app/app/activity src/app/app/settings src/app/app/invitations src/app/app/onboarding "src/app/(auth)"
git commit -m "feat: restyle secondary app pages and auth screens to match the product design"
```

---

### Task 8: E2E reconciliation, full verification gate, and visual check

**Files:**
- Modify (only if a selector genuinely broke): `e2e/phase1.spec.ts`, `e2e/product.spec.ts`

- [ ] **Step 1: Run the complete e2e suite on both projects**

```bash
./node_modules/.bin/next dev &          # wait for http://127.0.0.1:3000
npx playwright test
```

Expected: all specs PASS on chromium **and** mobile. If the mobile project fails in `openSection` because the sidebar nav link is off-canvas, apply the **minimal** reconciliation: make `openSection` open the drawer first, e.g. before locating the link add:

```ts
  const toggle = page.getByRole("button", { name: "Open navigation" });
  if (await toggle.isVisible()) await toggle.click();
```

Do not change the nav's markup or accessible names to satisfy the test.

- [ ] **Step 2: Run the full verification gate**

```bash
npx eslint . && npx tsc --noEmit && npx vitest run && npx next build && npx supabase test db && npx playwright test
```

Expected: eslint clean; tsc clean; vitest all green (untouched domain suites); `next build` succeeds; pgTAP all files PASS (schema unchanged — no `db reset` needed); Playwright all PASS on both projects including every axe check. If any privacy-hook false-positive blocks a commit later, `--no-verify` is permitted only with zero genuine findings.

- [ ] **Step 3: Manual visual check at desktop + mobile widths**

With the dev server running, capture screenshots of the three highest-traffic pages at both widths and eyeball them against the demo:

```bash
npx playwright screenshot --viewport-size=1280,900 http://127.0.0.1:3000/app /private/tmp/uplift-dashboard-desktop.png
npx playwright screenshot --viewport-size=390,844  http://127.0.0.1:3000/app /private/tmp/uplift-dashboard-mobile.png
npx playwright screenshot --viewport-size=1280,900 http://127.0.0.1:3000/app/tasks /private/tmp/uplift-tasks-desktop.png
npx playwright screenshot --viewport-size=390,844  http://127.0.0.1:3000/app/tasks /private/tmp/uplift-tasks-mobile.png
npx playwright screenshot --viewport-size=1280,900 http://127.0.0.1:3000/app/evidence /private/tmp/uplift-evidence-desktop.png
npx playwright screenshot --viewport-size=390,844  http://127.0.0.1:3000/app/evidence /private/tmp/uplift-evidence-mobile.png
```

(These routes require a signed-in session; if the CLI screenshotter has no session, instead take the screenshots inside a short Playwright script that reuses the phase1 workspace-creation helper, or capture them manually in a logged-in browser.) Confirm: dark sidebar with active-route highlight; header bell + avatar; stat rows and cards render; the dashboard needs-attention queue shows source pills; mobile collapses the sidebar to the drawer and the content is single-column with no horizontal overflow.

- [ ] **Step 4: Final commit (if reconciliation changed any spec)**

```bash
git add e2e
git commit -m "test: reconcile e2e selectors with the product shell nav"
```

- [ ] **Step 5: Offer to finish the branch**

Use `superpowers:finishing-a-development-branch` to present merge/PR options. Do not merge without the user's decision.

---

## Self-review notes

- **Spec coverage:** §3 AppShell → Task 1; §4 dashboard → Task 2; tasks → Task 3; evidence → Task 4; risks/SoA/assessment → Task 5; notifications + deferred aria polish → Task 6; activity/settings/invitations/onboarding + auth → Task 7; §5 hard constraints + §6 testing (added dashboard assertion in Task 2, full gate + visual in Task 8) → Global Constraints + Task 8; §7 sequencing → Tasks 1–8 in order.
- **Single-main / single-h1:** guaranteed by `AppShell` owning `<main className="content">` + header `<h1>`; every page returns a fragment (Task 1 sweep).
- **AA tokens:** relocated from `demo.css` to `globals.css` in Task 1 so `/app` inherits them — no new colours introduced.
- **Selector safety:** each interior task lists the exact strings/roles it must preserve; Task 8 is the only place a spec may be edited, and only minimally.
