# Codex overnight goals — 2026-07-13

Handoff for autonomous overnight work. Claude (Opus) hit its weekly limit; this doc
is the source of truth so Codex can continue without a human in the loop until morning.

---

## 0. Where things stand (read first)

- `main` @ `f2b5edd` — the **production-hardening** + **active-monitoring** work is
  committed, merged, and **pushed to `origin`** (github.com/mukta2701/ComplianceHub).
- Hosted Supabase prod (`etpiqjbehbchkkzmbjzt`) is **fully migrated** — `migration list`
  shows every local migration == remote, including `20260712100000_hardening_ratelimit_errors`.
- Working tree is **clean**. Tests green at merge: lint + tsc clean (1 pre-existing
  `_val` unused-var warning only), **306/306 vitest**, `next build` green.

### What is DONE and must NOT be redone
Rate limiting (Postgres-backed), self-hosted error logging (`app_errors`), error
boundaries, `/api/health`, AES-256-GCM secrets-at-rest (`src/lib/security/secrets.ts`,
wired through every token/webhook site), Jira SSRF allowlist, password-reset flow,
`siteUrl()` fail-fast, team lifecycle (role/remove/revoke), active compliance
monitoring (`src/features/monitoring/`, `/api/cron/monitor`).

---

## 1. DO NOT ATTEMPT (out of scope for Codex — needs the human)
These are blocked on dashboards / secrets Codex cannot supply. Do not fake, stub, or
work around them:
- **Vercel env vars** (`APP_ENCRYPTION_KEY`, `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL`) and
  triggering the Vercel prod deploy — no Vercel CLI on this machine; dashboard only.
- **Supabase Auth email-confirmation toggle** — deliberately left OFF (enabling without
  SMTP breaks sign-ups). Leave it.
- **Real OAuth connectors** (GitHub/Google/AWS live wiring) — needs the user's OAuth apps
  + client secrets. You MAY improve adapter *code + tests behind the existing flags*
  (`INTEGRATIONS_LIVE` / `MONITORING_LIVE` / `EVIDENCE_LIVE`), but they must stay
  sandbox/fake by default. Never commit a secret.

---

## 2. Hard rules (this repo will bite you otherwise)
1. **No `pnpm` on PATH.** Use `npx` or `./node_modules/.bin/*`. (`next`, `vitest`,
   `eslint`, `tsc`, `playwright` all resolve via `./node_modules/.bin`.)
2. **`"use server"` files may only export async functions.** Any constant (e.g. a row
   cap, a config map) MUST live in a separate non-`"use server"` module (`limits.ts`
   pattern). This fails at **build**, not vitest — so always run the full gate.
3. **Pre-commit privacy hook false-positives.** Commit with `--no-verify` when it blocks
   on known false fingerprints. (Do still eyeball your own diff for real secrets.)
4. **Playwright:** run with `--workers=1` (or `2`). The dev server line says `pnpm dev`
   but `reuseExistingServer` is on — start `./node_modules/.bin/next dev` yourself first.
5. **Local DB writes:** two Docker runtimes both host `supabase_db_compliancehub`; the
   IPv4/IPv6 split makes `supabase db reset` flaky. Apply local SQL via
   `docker exec -i supabase_db_compliancehub psql` against `127.0.0.1:54322`.
   **Do NOT run `supabase db push`** (that hits hosted prod — human-gated).
6. **New migrations:** idempotent `create ... if not exists` / guarded `alter`, mirroring
   `20260712100000`. Add a matching pgTAP file under `supabase/tests/database/` for any
   new table/RLS. pgTAP runs in CI; it can't run locally here.
7. `allowedDevOrigins: ["127.0.0.1"]` in `next.config.ts` is load-bearing for dev — leave it.

## 3. Definition of done for EVERY task
- `npm run verify` is **green** (lint → tsc → vitest → build). Non-negotiable.
- New behaviour has a test (TDD: red → green). Pure logic → vitest; DB/RLS → pgTAP.
- Then **self-merge to `main`** (fast-forward), push, and **delete the branch**.
  Mukta wants short-lived branches — one task, one branch, gone once merged. No sprawl.

## 4. Branch & concurrency discipline
- **One agent per file-area.** The tasks below are ordered to NOT overlap in files so
  parallel agents don't collide. If you must touch a shared file (`globals.css`,
  `app-shell.tsx`, a shared action file), take it alone and merge before the next agent
  starts on it.
- Branch naming: `codex/<short-task-slug>`. Rebase on latest `main` before merging.
- If verify won't go green after a genuine effort, **stop, leave the branch, and write a
  one-line note in `docs/codex-overnight-notes.md`** rather than merging broken work.

---

## 5. Task queue (priority order — each is independent)

### T1 — Docs accuracy sweep  *(file-area: docs/ + README)*
README/docs overstate policy-template capabilities and may still mention `pnpm`.
- Correct the policy-templates claim to match what actually ships (policies exist;
  prebuilt template library does NOT — verify against `src/features/policies` &
  `src/app/app/policies`).
- Grep for `pnpm` in docs and fix to `npm`/`npx` (only `package-lock.json` exists).
- **DoD:** `npm run verify` green (docs-only, so trivially green); merge.

### T2 — Deprecated Zod idiom sweep  *(file-area: validation schemas)*
Replace deprecated `z.string().uuid()` with `z.uuid()` across schemas.
- `grep -rn "z.string().uuid()" src` → migrate each. Watch for other deprecated idioms
  the linter flags. Also kill the lone `_val` unused-var eslint warning if trivial.
- **DoD:** no behaviour change; existing tests still pass; lint warning count drops; merge.

### T3 — Transactional recurrence regeneration  *(file-area: daily sweep / recurrence)*
Recurrence regeneration is currently non-transactional (partial-failure can leave
orphaned/duplicate task rows). Wrap the delete-old + insert-new in a single DB
transaction (or a security-definer RPC that does both atomically).
- Add a vitest (pure) and/or pgTAP proving no partial state on mid-op failure.
- **DoD:** verify green + new test; merge.

### T4 — Auditor-view access log  *(file-area: auditor tokens)*
Deferred from Phase C: time-boxed auditor access has no access log. Add an
`auditor_access_log` table (org-scoped, owner-readable RLS, service/RPC insert) and
record each successful `audit_view_for_token` resolution (token id, ts). Surface a small
"recent auditor views" list on the owner-facing audits/settings area.
- New migration (idempotent) + pgTAP for the RLS (owner-only read, cross-tenant denied).
- **DoD:** verify green + pgTAP; merge.

### T5 — Monitoring Realtime toast push  *(file-area: alert-toaster + a browser client)*
`components/alert-toaster.tsx` polls `fetchRecentAlertsAction` every 15s because no
browser Supabase client exists (app is server-rendered + server-actions only). Add a
minimal browser client (anon key, `@supabase/ssr`) and subscribe to
`monitoring_findings` inserts for the active org, falling back to the existing poll if
Realtime is unavailable. Keep it flag-safe and don't leak the service key.
- **DoD:** verify green; a test around the fallback logic; merge. (Realtime itself can't
  be unit-verified here — keep the change small and the fallback intact.)

### T6 — WhatsApp/Twilio alert adapter  *(file-area: monitoring delivery)*
`src/features/monitoring/application/deliver.ts` has a whatsapp **stub**. Flesh out a
real Twilio adapter behind a `TWILIO_*` env gate, defaulting to the fake/no-op when
unset (so no creds needed to run). Route by `min_severity` like the Slack adapter.
- Mirror the Slack adapter's port/payload split; add a deterministic fake + test.
- **DoD:** verify green + delivery test; merge. Do NOT hit the real Twilio API.

### Lower priority / only if time (pick one, don't half-do many)
- **T7** Import history + undo (Phase B.5 deferral) — new `import_runs` table, record each
  run, allow undo of the last import. Bigger; scope carefully.
- **T8** KPI trend + inline edit UI (Phase C deferral).
- **T9** Single colour-tokenisation pass — replace inline hexes (`#596273` `#edf0f4`
  `#fffbef` `#efe1aa`, alert `#f0c9c9` `#fdf2f2`, auth-page hexes) with the AA tokens in
  `globals.css`; restore the tasks-table Save secondary border; add a `.field` class so
  `soa/[id]` inline inputs get the brand focus ring. **Touches `globals.css` — take alone.**

---

## 6. Morning report
Before you go quiet, append a short summary to `docs/codex-overnight-notes.md`:
which tasks merged (with commit SHAs), which were skipped and why, and any new blocker
that needs the human. Keep `main` green — a merged-but-broken `main` is worse than an
unfinished task left on its branch.
