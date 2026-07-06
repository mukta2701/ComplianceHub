# Phase D — Policies + Integrations (Design Spec)

**Date:** 2026-07-06
**Status:** Draft for founder review
**Parent roadmap:** `2026-07-05-product-roadmap-v3.md` §Phase D (approved, final build phase).
**Binding:** v2 §10 — RLS + pgTAP attack tests (all 4 cross-tenant verbs) on every new tenant table; tenant + audit triggers; reuse the existing tasks/notifications/evidence engines (no parallel machinery); Phase A design system (fragments/single-h1/axe-zero); en-GB; original content; NO service-role in request paths (the daily-sweep cron is the only service-role user; a new poll cron may use it, tenant-scoped).

## Goal

Two workstreams. **D1 Policy management:** author policies with an approval state and per-employee acceptance tracking; a material edit re-triggers acceptance; policies attach as evidence. **D2 Ticketing integrations:** push a remediation task to Jira or GitHub Issues as a ticket (pre-filled), and poll status/assignee back. Exit criterion: policies can be published, accepted, and evidenced; a task can be pushed to a connected tracker and its status synced back.

## Decisions (locked; revisable at review)

1. **Policies attach as evidence via the EXISTING `evidence_links.policy_id`** — that column already exists (in the one-target check `num_nonnulls(control_id, risk_id, task_id, policy_id, audit_checklist_item_id) = 1`, added earlier), so policies were anticipated. This phase creates the `policies` table the `policy_id` refers to and (if `policy_id` currently lacks an FK) adds the composite tenant FK. Confirm the current FK state in the plan.
2. **Integrations are provider-abstracted and fake-testable.** A `TicketProvider` interface (`createTicket`, `fetchTicket`) with `jira` and `github` adapters. All in-app logic (push-task, store link, poll-sync) is tested against a FAKE provider — no live network in tests. **Connecting a REAL Jira/GitHub org requires the user to register an OAuth app and supply client id/secret + enable the poll cron** — this is a documented user step (go-live-adjacent), delivered as a connect checklist. The code is complete and tested; the live connection is user setup.
3. **No secret in plaintext at rest beyond what's unavoidable.** OAuth access/refresh tokens for a connection are stored in `integration_connections` (a tenant table, owner-only RLS). For local/dev they're env-driven; document that production needs Supabase Vault or an encrypted column (go-live hardening). Tokens are never sent to the client.

## Scope — two workstreams

### D1. Policy management (`src/features/policies`)

- New enum `policy_status` (`draft/in_review/approved/archived`). New table `public.policies`: `id`, `organisation_id`, `reference` (e.g. `POL-001`), `title`, `body` (text — the policy content/markdown, or a link/evidence ref), `version int not null default 1`, `status`, `owner_id → memberships` (composite tenant FK), `approved_by → memberships` (nullable), `approved_at` (nullable), `review_due date` (nullable), timestamps, `created_by`. Split RLS, tenant + audit triggers, pgTAP attack tests (all 4 verbs).
- New table `public.policy_acceptances`: `id`, `organisation_id`, `policy_id → policies` (composite tenant FK), `user_id → memberships` (composite tenant FK), `accepted_version int`, `accepted_at`, unique `(policy_id, user_id)`. Split RLS + triggers + attack tests. A member accepts a policy (records their acceptance at the current version).
- **Material-edit reset:** a domain rule + server action — editing a policy's `body` (a material change) bumps `version`, clears/invalidates prior acceptances (acceptances are version-stamped, so a member who accepted v1 shows as "needs to re-accept v2"), and posts a notification (reuse the existing `notifications` engine) to members to re-accept. A non-material edit (e.g. fixing the review date) does NOT bump version.
- **Attach-as-evidence:** a policy can be linked as evidence via `evidence_links.policy_id` (already supported) — surface a "link as evidence" affordance, reusing the evidence link actions.
- Domain (status labels, acceptance summary = accepted/total members at current version, needs-review heuristic) + tests. Server actions (create/update/approve/accept). Pages: `/app/policies` (list + acceptance %), `/app/policies/new`, `/app/policies/[id]` (detail: body, approval controls for owners, accept button for members, acceptance roster). Nav + TITLES. e2e + axe.

### D2. Ticketing integrations (`src/features/integrations`)

- New enum `integration_provider` (`jira/github`). New table `public.integration_connections`: `id`, `organisation_id`, `provider`, `label`, `config jsonb` (project key / repo owner+name), `access_token`/`refresh_token` (text, owner-only RLS — dev/env for now, Vault at go-live), `connected_by → memberships`, `created_at`, `revoked_at`. Owner-only RLS + attack tests.
- New table `public.task_tickets`: `id`, `organisation_id`, `task_id → tasks` (composite tenant FK), `connection_id → integration_connections`, `provider`, `external_id` (text), `external_url` (text), `external_status` (text), `external_assignee` (text nullable), `last_synced_at`, unique `(task_id, connection_id)`. Split RLS + attack tests.
- **`TicketProvider` interface** (`src/features/integrations/domain/provider.ts`): `createTicket(conn, { title, body }) → { externalId, url, status }`; `fetchTicket(conn, externalId) → { status, assignee, url }`. **Fake provider** (in tests) + `jira`/`github` adapters (`src/features/integrations/application/{jira,github}.ts`) that call the real REST APIs (Jira `/rest/api/3/issue`, GitHub `/repos/{o}/{r}/issues`) using the connection's token. The adapters are thin and NOT exercised by tests against live network — the fake proves the in-app flow.
- **Push action:** from a task, `pushTaskToTrackerAction(taskId, connectionId)` — RLS-scoped, pre-fills title/body from the task (title, detail, source, linked control), calls `provider.createTicket`, stores a `task_tickets` row. One-click "Send to Jira/GitHub" on the task detail page (shown only if a connection exists).
- **Poll-sync:** a cron route `POST /api/cron/integrations-sync` (CRON_SECRET-gated, like the daily sweep) that, for each active `task_tickets` row, calls `provider.fetchTicket` and updates `external_status`/`external_assignee`/`last_synced_at`. Service-role, tenant-scoped per row. Domain logic (which rows are due, how status maps) is pure + fake-tested. **Enabling this cron in production is a user step** (Vercel cron + CRON_SECRET — folds into go-live).
- **OAuth connect:** an owner "Integrations" settings area to add a connection. The OAuth flow (redirect to Jira/GitHub, callback stores tokens) is built but **requires the user's registered OAuth app client id/secret** (env vars) to function against a real provider — documented in the connect checklist. For dev/test, a connection can be created with a token directly (owner-only).
- Domain + tests (provider interface via fake, push mapping, poll due-logic, status mapping). Pages: task detail "Send to tracker" + ticket status chip; `/app/settings` (or `/app/integrations`) connect/list/revoke. Nav/entry. e2e (with the fake provider) + axe.

## Testing (per v2 §10)
- pgTAP (all 4 cross-tenant verbs) for `policies`, `policy_acceptances`, `integration_connections` (owner-only), `task_tickets`.
- Domain unit tests: policy acceptance summary + material-edit version/reset logic; provider interface via the FAKE (createTicket/fetchTicket round-trip); push mapping; poll due-logic + status mapping.
- E2E + axe: create+approve a policy → member accepts → material edit bumps version + posts a re-accept notification → acceptance roster reflects it; link a policy as evidence; (integrations, fake provider) create a dev connection → push a task → ticket link + status chip appear → simulate a poll updating status. Zero axe violations on every new page.
- Full gate: eslint, tsc, vitest, next build, `supabase test db`, Playwright (chromium + mobile).

## Non-goals (Phase D)
No live-network integration tests (fake provider only); no bidirectional write-back beyond status/assignee read; no third tracker; no policy e-signature/legal workflow; no AI; no integration marketplace (just Jira + GitHub).

## User-dependency callouts (fold into the go-live checklist)
- Connecting a real Jira/GitHub org: register an OAuth app (client id/secret), set env vars, complete the OAuth connect flow.
- Enabling poll-sync in production: add the `/api/cron/integrations-sync` Vercel cron + `CRON_SECRET`.
- Production token storage: move `access_token`/`refresh_token` to Supabase Vault or an encrypted column.

## Exit criteria
Policies can be authored, approved, accepted, re-accepted on material edit, and linked as evidence. A task can be pushed to a connected tracker (proven with the fake provider) and its status polled back. Full test gate green. Real-provider connection + poll cron are documented user steps.
