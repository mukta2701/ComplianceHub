# ComplianceHub — Full-App Design & Feature Improvement Draft

**Date:** 2026-07-06
**Author:** Opus 4.8 (controller), from a full-app screenshot audit (30 screens, `artifacts/full-audit-2026-07-06/`), an Opus vision design review, and 2026 GRC/UX benchmark research.
**Status:** Draft for **Fable** review. Fable prioritises + refines these into tasks and hands them out: **heavy/agentic work → Opus 4.8**, **light/mechanical work → Sonnet 4.5** (each item below is pre-tagged with a suggested model + effort so Fable can dispatch quickly).
**Scope:** localhost build (all phases 1 + A + B + B.5 + C + D merged to `main` @ `0f4dc58`). The **live** site is not deployed yet — go-live needs the user (accounts/secrets, §D). Live screenshots will follow once deployed.

---

## How to read this (for Fable)

Every actionable line is tagged `[model · effort · labels]`:
- **model** = suggested owner: `Opus` (design judgement, multi-file, cross-cutting, correctness-sensitive) or `Sonnet` (mechanical, single-surface, well-specified).
- **effort** = `S` (≤1 file / <1h), `M` (a few files), `L` (a workstream).
- Priorities: **P1** = hurts first impression / correctness / accessibility; **P2** = polish/consistency gap; **P3** = nice-to-have.

Do the P1 design fixes **before** any new feature work — they are cheap and they fix a first impression that currently undercuts the whole product.

> **Already fixed this session (verified, gate-green, on `main`):** **A1** (readiness single source of truth — dashboard now agrees with the report, empty = 0% not 100%), **A2 + A5** (shared `EmptyState` component + inviting empty states across Risks, Assets, Evidence, Audits, KPIs, Assessment), **A3** (app Settings rebuilt to the demo bar — workspace details, team roster with role pills + invite, security status, all real data; the duplicated footer removed), **A4** (mobile dashboard action overlap — `.card-foot` wraps), **A6** (Policy-detail redesign — green "Accepted"/"Approved" pills instead of pale disabled-looking buttons, a single approval control, and the body no longer duplicated — edit is behind a disclosure), **A7** (Integrations humanised — friendly "Sandbox mode" framing; the env-var/cron/Vault internals moved into a collapsed "for your administrator" section), **A8** (Tasks filter → segmented pills; root cause was `.segmented` CSS matching only `button`, not the `<a>` filters), **A9** (dashboard "Start assessment" until one exists), **A11** (SoA dead-end → EmptyState pointing to Assessment). **Remaining for Fable to assign:** A10 (mobile table clipping), A12–A17 (P3 polish), and the whole feature roadmap (Part B).

---

## Executive summary

The design *system* is strong: the demo workspace (Northstar Labs) sets a genuinely high bar — rich stat cards, a readiness donut, a 5×5 risk heat map, calm tables, a polished assessment flow. **The gap is the real, empty app.** A brand-new workspace's first impression is undermined by three things: (1) **contradictory, misleading readiness** — the dashboard shows **100% READY** while the Leadership report shows **0% READY** for the identical empty state; (2) **dead-end empty states** — the Risk register is a bare table header with nothing beneath it, and other registers are flat one-liners; (3) **two screens that regress hard** — app Settings is nearly blank with a duplicated footer, and the Policy detail stacks five pale, low-contrast cards with the policy text shown twice.

Feature-wise, ComplianceHub is a complete *manual* ISMS. The 2026 market bar has moved to **continuous evidence automation, a public Trust Center, and multi-framework control mapping**. Those are the differentiating bets (§B).

**Fix first (cheap, high-impact):** the readiness contradiction, a standard inviting empty-state component, the Settings rebuild, and the mobile action overlap. **Then invest in:** onboarding checklist, policy templates, and continuous evidence automation.

---

## Part A — Design & UX fixes (prioritised)

### P1 — first impression / correctness / accessibility

**A1. Readiness is contradictory and misleading on an empty workspace.**
Dashboard (`10`) donut = **100% READY** with "Assessments 0 · Open risks 0 · Finalised SoAs 0"; Leadership report (`23`) donut = **0% READY** for the same state. Same word "readiness", two different computations, opposite numbers. For a compliance tool this destroys trust in every metric.
→ Compute readiness **once** (a single `computeReadiness(context)`), render both surfaces from it, treat *zero inputs* as **"Not started / 0%"** (an empty ring + "Start your first assessment to see your score"), not 100%. Add a vitest asserting dashboard and report agree for the same inputs. `[Opus · M · correctness, dashboard, reports]`

**A2. Risk register empty state is a bare table header.** (`16`) Just "REF / RISK / INHERENT / RESIDUAL / STATUS / REVIEW" over blank space — reads as broken/loading. The RAG-threshold config card also shows before any risk exists (premature).
→ Replace with a real empty state: icon + one line ("Your risk register tracks inherent and residual exposure on a 5×5 matrix") + a prominent **"Add your first risk"** and **"Import from spreadsheet"** pair (buttons already exist top-right). Collapse the RAG-threshold card behind a "Configure bands" disclosure until ≥1 risk exists. `[Opus · M · empty-state, risks]`

**A3. App Settings is nearly empty and the footer disclaimer renders twice.** (`25`) A big regression from the demo Settings (`07`), which has workspace details, team roster, notification toggles, and security status. The duplicated footer is a visible layout bug.
→ Port the demo Settings sections into the real app (workspace name/slug/company number; team-member list with roles + the existing invite form; notification preferences; security status). Remove the duplicated footer node. `[Opus · M · settings, layout-bug]`

**A4. Mobile dashboard action buttons overlap.** (`27`) At 390px the "Add starter calendar" button collides with the "Add evidence" / "Review gaps" links on one cramped row — overlapping tap targets.
→ Stack the three actions vertically (or wrap) below the message on narrow viewports; ensure each has a clear, separated, ≥44px tap target. Add a Playwright mobile assertion. `[Sonnet · S · mobile, layout-bug]`

**A5. Standardise one inviting empty-state component and apply it everywhere.** (`16, 17, 18, 19, 21, 22, 26`) Every register invented its own pattern (bare header, or flat one-liner). Research: an empty state must answer *what is this / why it matters / what next*, and inviting empty states + an onboarding checklist push activation from ~25–30% to 40%+.
→ Build `<EmptyState icon title body primaryCta secondaryCta />`; model it on the Tasks starter card (`20`, the current best). Apply to Assets, Evidence, Audits, KPIs, Assessment, SoA. `[Opus · M · empty-state, design-system]`

### P2 — polish / consistency

**A6. Policy detail is a long, sparse, low-contrast card stack with duplicated content.** (`12`) Five plain white cards; the policy text appears twice (read view + edit textarea); the accept/approve actions are pale blue-grey and read as **disabled** (WCAG contrast concern); Approval offers *both* a greyed "Approve policy" button **and** a "Draft" dropdown + "Set status" (two overlapping controls).
→ Collapse read+edit into one editor (or an "Edit" toggle); move Approval + Acceptance into a compact header status strip or right-hand sidebar; tighten vertical rhythm; give accepted/approved a clear **done** treatment (green check pill, not a pale button); pick **one** approval control. `[Opus · M · policies, accessibility]`

**A7. Integrations page leaks developer internals to end users.** (`14, 15`) The "Go-live checklist" shows `INTEGRATIONS_LIVE=1`, `CRON_SECRET`, `/api/cron/integrations-sync`, "move tokens to Supabase Vault" — server-setup docs in a product aimed at non-technical 10–50-person teams.
→ Move infra steps to admin docs. In-product: a friendly "Connect Jira / GitHub" flow with a **"Sandbox mode"** badge and a "Learn about going live →" link. `[Opus · M · integrations, onboarding]`

**A8. Tasks filter row is unstyled run-together text.** (`20`) "All Open In Progress Done Cancelled Overdue" with no pill/tab styling and no active-state indication.
→ Render as segmented pills/tabs with a clear active state (the demo Risks filter chips already do this). `[Sonnet · S · tasks, design-system]`

**A9. "Continue assessment" shown when none has started.** (`10`) Wrong verb for a first-time user.
→ "Start assessment" until one exists, then "Continue assessment". `[Sonnet · S · dashboard, copy]`

**A10. Mobile tables clip horizontally with no scroll cue.** (`28, 29`) The heat-map right column and register "Treatment" column are cut off; the policy list truncates ("Information Se…").
→ Wrap wide tables in `overflow-x:auto` with a visible scroll cue, or switch to stacked row-cards on mobile; scale the heat map to viewport width. `[Opus · M · mobile, tables]`

**A11. SoA empty state is a dead end when no assessment exists.** (`17`) "Generate draft" is the primary path but there's nothing to generate from.
→ Disable "Generate draft" with helper text "Complete an assessment first →" linking to Assessment. `[Sonnet · S · soa, empty-state]`

### P3 — nice-to-have

- **A12.** Group the 15-item left nav into sections ("Assess / Manage / Evidence & Audit / Admin") — the flat list slows scanning. `[Opus · M · navigation]`
- **A13.** Demo risk heat map has a large empty left gutter and eats vertical space — centre it and cap height. `[Sonnet · S · demo, dataviz]`
- **A14.** Add "Forgot password?" to sign-in (`08`). `[Sonnet · S · auth]`
- **A15.** Style native `dd/mm/yyyy` date inputs and `<select>`s to match the rounded design-system inputs (`11, 12, 16, 22`); add the `.field` focus-ring helper (already a carried-over follow-up). `[Sonnet · S · design-system]`
- **A16.** Sidebar workspace switcher shows generic "Your workspace" on the post-creation dashboard (`10`) but "Acme Health" on later pages (`12`) — a hydration inconsistency; show the org name immediately. `[Opus · S · shell, hydration]`
- **A17.** Demo Settings role indicators are full-width rounded bars that read like buttons (`07`) — use compact role pills. `[Sonnet · S · settings]`

---

## Part B — Feature roadmap (2026 benchmark-driven)

The market bar (Vanta / Drata / Scytale, 2026): continuous monitoring, automated evidence, Trust Centers, multi-framework mapping. ComplianceHub is a complete *manual* ISMS; these are the differentiating bets. Ranked by impact-to-effort.

**B1. First-run onboarding checklist. `[Opus · M · onboarding]`**
A dismissible "Get certification-ready" checklist on the dashboard: create workspace ✓ → run assessment → publish your first policy → add your first risk → connect a tracker → invite your team. Checklists lift activation from ~25–30% to 40%+. Pairs directly with the A5 empty states. **Do this first — it's the cheapest growth lever.**

**B2. Policy starter templates. `[Opus · M · policies, onboarding]`**
Seed a starter set of ISO 27001 policies (Information Security, Access Control, Incident Response, Supplier Security, Acceptable Use, BYOD, Business Continuity…) as original, editable drafts, so a new org publishes in minutes instead of authoring from a blank textarea. Highest-leverage content play; leans on the shipped policy engine.

**B3. Continuous evidence automation (the biggest differentiator). `[Opus · L · evidence, integrations]`**
Today evidence is manual. The 2026 bar is auto-collection: connect cloud/identity/HR (e.g. Google Workspace, GitHub, AWS) and auto-refresh evidence + alert on drift. Build on the existing `TicketProvider`-style abstraction: an `EvidenceProvider` interface + FAKE-tested collectors + the daily sweep marking auto-evidence fresh/stale. Real connectors are go-live/user-secret-dependent (same pattern as Jira/GitHub). Turns "40–80h once a year" into "2–4h/month".

**B4. Public Trust Center. `[Opus · L · reports, public]`**
A branded, public, read-only page showcasing security posture (framework coverage, control status, policy list, uptime) — reusing the Phase C auditor-view security-definer + public-route pattern, but org-configurable and shareable as a sales asset. High commercial value.

**B5. Multi-framework control mapping. `[Opus · L · controls, soa]`**
Map controls across ISO 27001 / SOC 2 / GDPR / HIPAA so overlapping requirements share evidence and tests. Large but strategic — it's how modern tools justify their price.

**B6. Scheduled policy review reminders. `[Sonnet · S · policies, automation]`**
Use `review_due` + the daily sweep to raise a task/notification when a policy is due — closes the loop on the existing field.

**B7. Integrations two-way sync + chat alerts. `[Opus · M · integrations]`**
Close the ComplianceHub task when the external ticket closes; post re-accept / overdue / finding alerts to Slack/Teams.

**B8. KPI trend charts + RAG + management-review minutes. `[Opus · M · kpis, reporting]`**
The KPI log is flat today; add trend-over-time, threshold RAG, and an agenda/minutes record for the management review.

**B9. Recurring audits + Annex A checklist templates. `[Opus · M · audits]`**
Auto-create the annual/quarterly audit cycle; pre-populate the checklist from a framework's full Annex A set.

*(Full enhancement list, incl. Phase B/B.5/C/D deferrals, lives in `docs/feature-backlog.md` + `.csv`.)*

---

## Part C — Cross-cutting principles (from 2026 research)

1. **Every empty state answers three questions** — what is this, why it matters, what to do next — and offers a first action (add + import). *(Sources: Userpilot, Eleken, Pencil&Paper.)*
2. **One source of truth for every metric.** Readiness must be computed once (A1). *(GRC trust bar.)*
3. **Dashboards are decision cockpits, not report dumps** — reduce cognitive load; every element supports the current decision or is removed (46.7% of dashboard users hit information overload). *(FuseLab, UXPilot.)*
4. **Accessibility-first as competitive advantage** — WCAG AA: 4.5:1 text, 3:1 non-text/UI components; never rely on colour alone; enabled ≠ disabled contrast (fixes A6). *(WebAbility, A11Y Collective.)*
5. **Time-to-value in weeks, not months** — onboarding checklist + templates + auto-evidence (B1–B3). *(Hyperproof, LogicGate.)*
6. **Usable by the whole org, not just the compliance lead** — group nav, plain-language copy, hide infra internals (A7, A12). *(Sprinto, MetricStream.)*

---

## Part D — Go-live checklist (USER-dependent — I cannot do these)

These require the account owner (I cannot create accounts or enter secrets):
1. **Hosting:** create the Vercel project + a hosted Supabase project; apply migrations `0001–0032`; set `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
2. **Crons:** set `CRON_SECRET`; wire the Vercel cron for `/api/cron/daily` **and** `/api/cron/integrations-sync`.
3. **Integrations (optional, when going live for real):** register Jira/GitHub OAuth apps; set client id/secret + `INTEGRATIONS_LIVE=1`; **move `access_token`/`refresh_token` to Supabase Vault or an encrypted column** before any real connection.
4. **Repo:** `main` is local-only (remote `github.com/mukta2701/ComplianceHub` is empty) — push when ready.
5. **Lockfile:** CI expects `pnpm`; local uses `npx`/`node_modules/.bin`. Decide pnpm-vs-npm lockfile before CI.

---

## Suggested Fable sequencing

1. **Wave 1 (design P1, ~1 day):** A1, A2, A3, A4, A5 — fix the first impression. Mostly Opus, one Sonnet.
2. **Wave 2 (design P2 + onboarding):** A6, A7, A8, A9, A10, A11 + **B1** onboarding checklist + **B6** review reminders.
3. **Wave 3 (content + differentiators):** **B2** policy templates, then **B3** continuous evidence automation (the strategic bet), **B4** Trust Center.
4. **Wave 4 (depth):** B5 multi-framework, B7 two-way sync, B8 KPI trends, B9 recurring audits; plus P3 polish (A12–A17).
5. **Go-live (user):** Part D.

Each wave: build → screenshot → catalogue to backlog → Fable reviews → next wave. Every code change keeps the v2 §10 bar (RLS + pgTAP all-4-verbs on new tenant tables, domain-first tests, e2e + axe zero, en-GB, no service-role in request paths).
