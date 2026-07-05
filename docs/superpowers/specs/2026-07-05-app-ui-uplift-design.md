# App UI Uplift — Promote the Demo Design Language to the Product

**Date:** 2026-07-05
**Status:** Draft, pending user review
**Depends on:** v2 Phase 1 (merged, `f6d24ab`)
**Explicitly out of scope:** Phase 2 policy management, marketing/landing redesign, any schema or server-action change, new features.

## 1. Problem

The authenticated app (`/app/*`) is styled as plain Tailwind-utility tables while the `/demo/*` showcase uses a complete product design language (dark sidebar shell, stat cards, status pills, page intros, dense data tables) that already lives in shared code. Real users see the plain version. The Phase 1 automation (gap→task, evidence expiry, daily sweep, notifications) is functionally present but visually buried, so the product "looks basic" and "doesn't feel different from v1".

## 2. Goal

One consistent product: every authenticated page uses the existing design system, and the dashboard makes the automation loop visible. No behavioural changes — same routes, same server actions, same data queries, same RLS posture.

## 3. Approach (chosen)

Promote the existing design system rather than invent a new one:

- **Design tokens & classes:** already global (`src/app/globals.css` — `--ink/--blue/--amber/...`, `.app-shell`, `.sidebar`, `.card`, `.stat`, `.pill`, `.data-table-wrap`, `.page-intro`, `.ring`, `.progress`). Reuse as-is; extend only where a real-app need has no class yet (e.g. form layouts, notification list). Additions go in `globals.css` in the same dense style.
- **Components:** reuse `src/components/ui.tsx` (`PageIntro`, `Card`, `Stat`, `Pill`, `Progress`, `Ring`) and `src/components/icons.tsx` everywhere in `/app`.
- **New `AppShell` component** (`src/components/app-shell.tsx`): the product twin of `DemoShell` — dark sidebar with the real module nav (Dashboard, Assessment, Risks, SoA, Tasks, Evidence, Notifications, Activity, Settings), active-route highlighting, org name from the session, user initials avatar, sign-out, and a live notification bell with unread count (moved from the current header into the shell). Mobile: same drawer/toggle pattern as `DemoShell` (client component for the toggle only; pages stay server components). `DemoShell` keeps its banner and fake data; both shells share CSS classes.
- `/app/layout.tsx` renders `AppShell` around children; per-page `<main>` wrappers are replaced by the shell's `.content` region.

### Alternatives considered
- New design system from scratch — rejected: weeks of work, discards a proven look, delays go-live.
- Restyle pages ad hoc without a shared shell — rejected: perpetuates drift between pages; the shell is where most of the perceived quality lives.

## 4. Page-by-page scope

All pages keep their current data queries and server actions verbatim. Presentation only.

| Page | Uplift |
|---|---|
| `/app` dashboard | Readiness `Ring`, stat row (`Stat` cards: open tasks, overdue, evidence items, expiring/expired), **needs-attention queue as the centrepiece** with per-row source labels ("Raised by daily sweep", "From assessment gap"), quick actions (Add starter calendar, Add evidence, Review gaps). This is the "feel the automation" page. |
| `/app/tasks` (+ `[id]`, `new`, `from-gap`) | `PageIntro`, stat row (open/overdue/recurring), demo-style data table with `Pill` statuses and overdue highlighting; forms restyled on card layout; starter-calendar CTA as empty state. |
| `/app/evidence` (+ `new`) | Same treatment; freshness pills (current/expiring/expired), link-to-control controls styled, empty state explains the vault. |
| `/app/risks` | Table → demo table style; gap-suggestion banner restyled as amber card (keep both Accept actions); score/band pills. |
| `/app/soa` (+ `[id]`) | Table + per-control freshness pills; linked-task widget as card. |
| `/app/assessment` | Progress bars via `Progress`; session cards. |
| `/app/notifications` | List as cards/rows with kind icons, unread pill, mark-read buttons (aria polish from the deferred-minors list lands here). |
| `/app/activity`, `/app/settings`, `/app/invitations`, `/app/onboarding` | Shell + `PageIntro` + card layout; onboarding gets the full guided treatment (it's the first thing a real user sees). |
| `(auth)` sign-in/sign-up | Light touch: centred card on the product background, logo, consistent buttons. No flow changes. |

## 5. Hard constraints

- Server-component architecture preserved; client components only where interactivity demands (shell nav toggle, existing forms).
- No changes to `src/features/**`, server actions, queries, migrations, or RLS.
- **Accessibility gates stay green:** axe runs on `/app/tasks`, `/app/evidence`, `/demo/tasks`, `/demo/evidence` in e2e; contrast tokens in `globals.css`/`demo.css` were tuned for AA — reuse them, don't invent new colour values.
- **E2E compatibility:** `e2e/phase1.spec.ts` and `e2e/product.spec.ts` selectors rely on headings, labels, roles and visible text (e.g. heading "Tasks", button "Add starter calendar", label "Valid until"). Keep that text and those roles identical. Where a structural change genuinely breaks a selector, adjust the spec minimally — never weaken page accessibility to satisfy a selector.
- en-GB copy, dense single-line component style per the existing codebase.
- Conventional commits, configured git author, no co-author trailer.

## 6. Testing

- Full existing gate must pass unchanged in meaning: eslint, tsc, vitest (untouched domain), next build, pgTAP (untouched schema), full Playwright including axe.
- Add one e2e assertion: the authenticated dashboard shows the needs-attention queue region (locks the centrepiece in place).
- Visual verification: run the app and screenshot dashboard, tasks, evidence at desktop and mobile widths before calling it done.

## 7. Sequencing & deliverables

1. `AppShell` + `/app/layout.tsx` + dashboard (the highest-impact slice).
2. Tasks + evidence pages (the Phase 1 modules).
3. Risks, SoA, assessment, notifications.
4. Activity/settings/invitations/onboarding + auth pages.
5. E2E reconciliation + full gate + visual check.

Deferred minors from the Phase 1 ledger that are UI-adjacent (notification aria polish) are folded into step 3; the non-UI deferred minors (zod idiom, update-policy pinning, recurrence transactionality) stay deferred.

## 8. Success criteria

A signed-in user cannot tell the app and demo apart on visual quality; the dashboard demonstrates work arriving on its own (needs-attention queue with source labels); all automated gates green; no functional regressions.
