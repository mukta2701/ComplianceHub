# Public beta release checklist

- [ ] Project owner has reviewed and approved every assessment question and remediation.
- [ ] Legal, privacy, certification, and open-source disclaimers are visible and accurate.
- [ ] Production Supabase project uses the intended region and all migrations pass.
- [ ] Hosted Supabase personal staging project ref `ytenjiyjdcrjkgwmciqw` has a verified backup; `supabase migration list` and `supabase db push --dry-run` showed exactly the twenty reviewed migrations through `20260825073650` in order; migrations 1–18 were verified before the manual bridge, additive migrations 19–20 were verified before final, and the phase-specific `HOSTED_SUPABASE_MIGRATION_VERSION` always matched `NEXT_PUBLIC_SUPABASE_URL`.
- [ ] Cross-tenant RLS tests, immutable-record tests, and stale-write tests pass.
- [ ] Service-role and cron credentials are server-only, rotated, and stored in deployment secrets.
- [ ] Mukta has verified one Mukta-owned, server-approved private Slack destination; its canonical webhook SHA-256 is stored only in `SLACK_ALLOWED_WEBHOOK_SHA256`, the A/B secret references are coherent, and blank/malformed/mismatched/legacy configurations fail without a Slack write.
- [ ] The staged Slack rollout completed in order: manual `bridge` on migration `20260825040825`, health capability `v1`/`bridge` with the exact release SHA, additive migrations `20260825053718` and `20260825073650`, then manual `final` in `strict` mode. The first final followed the exact bridge revision; in steady-state operation, subsequent manual final and automatic runs stayed strict while accepting only an exact `v1` predecessor whose captured mode was `bridge` or `strict`. Final had exact same-slot Slack/core references, and rollback was pinned to the captured revision/image/references and matched its exact previous mode and release SHA.
- [ ] An Adtecher organisation owner approved the private GitHub App, one dedicated selected repository, exact read-only permissions/events, SSL verification, OAuth-during-install disabled, Redirect-on-update enabled, and the callback/setup/webhook URLs at the canonical origin.
- [ ] `REGISTERED_GITHUB_APP_SITE_URL` exactly equals `NEXT_PUBLIC_SITE_URL` and that origin exactly matches the Azure Container App ingress FQDN; all eight server-only GitHub values are present under their valid `AZURE_GITHUB_*` secret aliases in the protected personal `azure-staging` environment; the private key is PKCS#8 with literal escaped `\n`; no GitHub value is present in build inputs, local files, or client output.
- [ ] Do not merge to `main` or deploy while either hosted Supabase or GitHub App checkpoint above is incomplete; `main` auto-deploys after CI and the environment currently has no required reviewer gate.
- [ ] Email delivery, allowed redirect URLs, rate limits, and abuse monitoring are configured.
- [ ] Backup restoration has been exercised into a separate environment.
- [ ] Desktop and mobile critical journeys pass keyboard and automated accessibility checks.
- [ ] PDF and DOCX exports match the finalised snapshot.
- [ ] `npm run verify`, `npm run test:db`, and `npm run test:e2e` pass from a clean checkout.

## Local verification evidence — 2026-08-18

These checks prove the current local implementation only; they do not close the
hosted, Azure, Slack, GitHub-owner, email, or backup checkpoints above.

- [x] On the current hardening commit `5ba9586`, the release verification
  baseline passed lint, typecheck, **210 test files / 1,472 tests**, and the
  Next production build; the focused export, policy-evidence, monitoring
  owner/RLS, risk-matrix operator, audit-scoping, filename, active-workspace
  GitHub repository-selection, atomic KPI task, and atomic monitoring-task
  tests are included in that count. Assessment autosave, automation review,
  and SoA finalisation now return stable client errors instead of raw database
  details.
- [x] GitHub CI run `32158868448` for `3fd6ebd` passed Gitleaks, container,
  database upgrade/full pgTAP, application lint/typecheck/unit/build,
  integration, and the full desktop/mobile Playwright gate.
- [x] The CI database job ran `bash scripts/test-db-upgrade.sh` and
  `supabase test db` successfully. The local fixture-preserving DB run also
  passed `supabase test db`: **79 files / 1,257 tests**, including the atomic
  KPI and monitoring finding task RPCs plus operator-only risk mutations.
- [x] Fresh local `npm run test:integration`: 3 files / 5 tests against the
  running localhost Supabase stack.
- [x] GitHub CI run `32154415336`: **58/58 desktop + mobile tests passed**
  against the disposable CI fixture with one worker.
- [x] Local `/api/health` returned HTTP 200 with `db: ok`; the running local
  stack reports 101 applied migrations and the expected GitHub/automation/MCP
  tables are present.
- [x] Focused GitHub production shadow run: Chromium + mobile 2/2; local
  personal-pilot readiness unchanged.
- [ ] No earlier third-party workspace/channel smoke is accepted as release
  evidence. Prove the application-owned digest and monitoring paths only against
  Mukta's server-approved private Slack destination after the owner checkpoint.
- [x] `npm run test:db:upgrade`: passed earlier in the disposable/local upgrade
  gate (14 upgrade assertions, with the database restored afterwards); it was
  not rerun in this final fixture-preserving pass.
