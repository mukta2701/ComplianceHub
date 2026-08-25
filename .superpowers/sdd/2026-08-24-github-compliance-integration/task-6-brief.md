# Task 6 brief — Mukta-only Slack destination policy

Implement Phase 4 / plan Task 6 on the clean `codex/compliancehub-internal-tool`
worktree after Task 5B. This task must not call Slack, GitHub, hosted Supabase,
Azure, or any other external provider.

## Outcome

Every real Slack write is fail-closed to one server-approved Mukta-owned incoming
webhook. The user, model, UI label, workspace name, channel name, and stored URL
cannot choose or override the destination. Blank or malformed policy, a digest
mismatch, a legacy plaintext secret, or a race changing the selected channel must
fail before external fetch and, where specified below, before Slack-specific
configuration or delivery-ledger mutation.

## Policy contract

- Add the server-only `SLACK_ALLOWED_WEBHOOK_SHA256`, blank by default.
- Accept only exact lowercase 64-character hexadecimal. Do not trim, normalize,
  log, render, or return the configured digest.
- Validate the URL with the existing official Slack/Gov incoming-webhook
  validator, canonicalize with the returned `URL.toString()`, SHA-256 the exact
  UTF-8 canonical string, and compare 32-byte values with `timingSafeEqual` only
  after exact length validation.
- Expose only `approved` / `not_approved` decisions and generic errors. Never use
  a channel label/name/account string as identity.
- Persist the computed non-secret `webhookSha256` beside the encrypted `v1:`
  webhook in `alert_channels.config`. Reject legacy plaintext and missing stored
  digest before calling `decryptSecret`.
- A loopback receiver is allowed only through an injected test transport under
  `NODE_ENV=test`; localhost must never pass production URL validation.

## Required boundaries

1. `addAlertChannelAction`: validate policy before rate limiting, encryption,
   insert/audit, or revalidation; persist only the returned canonical URL and
   computed digest. Align Slack management with the Owner-only database policy.
2. Enabling an existing Slack channel and selecting a non-null daily channel:
   load the organisation-scoped config, reject missing/legacy/mismatch before
   update/RPC/audit. Disable, clear, and revoke stop paths remain available.
3. Daily digest: after Owner/fact/message read-only validation, load the selected
   active channel with the user client, reject envelope/digest before decryption,
   decrypt and re-approve, then apply the durable limiter, construct the service
   client, and reserve. Hold the canonical URL in memory. Recheck policy
   immediately before fetch; local rejection is confirmed `SLACK_REJECTED`, with
   generic wording and no network.
4. Monitoring: precheck the stored digest before decrypting each Slack row,
   isolate rejected Slack channels without starving finding/in-app/WhatsApp
   processing, and recheck the canonical URL immediately before the shared
   transport. No unapproved URL may reach `postSlack`.
5. Add a pinned-CLI successor migration that changes the service-only daily
   reservation RPC to require the prevalidated expected channel ID under the
   existing organisation/date advisory lock. A selected, failed-delivery,
   disabled, revoked, switched, or cross-organisation mismatch must return a
   safe no-channel state before delivery/attempt/audit mutation. **Superseded
   rollout ruling:** do not drop the old five-argument overload in this
   migration. Keep both overloads service-role-only for a manual bridge, default
   the application to strict, and retire the old overload only in a later
   reviewed migration after hosted final acceptance.

## Release/config/docs

- Advance the hosted migration attestation and ordered docs/contracts from 18 to
  19 migrations and the generated Task 6 version.
- Add the server-only secret to Azure A/B staging, rollback, Bicep, preflight,
  and exact-once secret-reference tests. It must never be a build arg,
  `NEXT_PUBLIC_` value, client bundle, health response, log, or command output.
- Update `.env.example`, deployment guide, release checklist, private pilot,
  architecture/backlog, and plugin/skill wording. Active guidance must refer only
  to a Mukta-owned server-approved private destination. Remove or explicitly mark
  AdTecher/Ankit/KT-SME Slack acceptance as invalid historical evidence.
- Use an explicit manual `bridge` then manual `final` rollout. Bridge alone may
  attest migration `20260825040825`, tolerate absent bootstrap/Slack refs, and
  fall back once on exact PostgREST `PGRST202`. Final and every automatic run are
  strict and require migration `20260825053718` plus exact same-slot references.
  The first final requires the exact policy-capable bridge revision. In
  steady-state operation, subsequent manual final and automatic runs may follow
  an exact policy-capable predecessor in `bridge` or `strict` mode. Health
  exposes only policy version, mode, and release SHA so the workflow can
  correlate the exact rollback revision and require its captured previous mode
  and release SHA instead of hard-coding bridge.

## Tests first

Record RED before production edits. Add:

- policy canonicalization, exact digest parsing, timing-safe comparison,
  official Slack/Gov URLs, mismatch/blank/wrong length/uppercase/unsafe URLs,
  legacy rejection before decrypt, privacy, and test-only injected loopback;
- action ordering/no-mutation tests for add, enable, and daily selection;
- daily ordering and every early failure with zero limiter/service/reserve/audit/
  fetch, expected-channel race, final recheck, exact retry/duplicate invariants;
- monitoring pre-decrypt rejection, valid delivery, final recheck, and isolation;
- a new pgTAP suite proving both overloads exist with service-only grants,
  expected-channel success, wrong/cross-org/disabled/revoked/switched zero
  delivery/attempt/audit mutation, and retry binding;
- local integration with injected transport only; build sentinel/static/health
  secret-absence contracts. Never put a real webhook or digest in fixtures.

Run focused tests, full Vitest, lint, typecheck, actionlint, Bicep compile, privacy
and diff checks; attempt the strict DB/upgrade/integration/build gates without
weakening them. Record Docker/Postgres and Google-font environmental blockers
exactly if still present.

Use strict TDD, preserve previous migrations, append the SDD ledger and create
`task-6-report.md`. Commit as:

`fix(slack): restrict delivery to an approved private destination`
