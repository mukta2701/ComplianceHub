# Public beta release checklist

- [ ] Project owner has reviewed and approved every assessment question and remediation.
- [ ] Legal, privacy, certification, and open-source disclaimers are visible and accurate.
- [ ] Production Supabase project uses the intended region and all migrations pass.
- [ ] Hosted Supabase personal staging project ref `ytenjiyjdcrjkgwmciqw` has a verified backup; `supabase migration list` and `supabase db push --dry-run` showed exactly the eleven reviewed migrations through `20260818110000` in order; they were verified before any application deployment; and `HOSTED_SUPABASE_PROJECT_REF` plus `HOSTED_SUPABASE_MIGRATION_VERSION` were set only afterwards and match `NEXT_PUBLIC_SUPABASE_URL`.
- [ ] Cross-tenant RLS tests, immutable-record tests, and stale-write tests pass.
- [ ] Service-role and cron credentials are server-only, rotated, and stored in deployment secrets.
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

- [x] On the current hardening commit `11c9815`, the release verification
  baseline passed lint, typecheck, **207 test files / 1,454 tests**, and the
  Next production build; the focused export, policy-evidence, monitoring,
  audit-scoping, filename, and active-workspace GitHub repository-selection
  tests are included in that count.
- [x] GitHub CI run `32149626188` for `11c9815` passed Gitleaks, container,
  database upgrade/full pgTAP, application lint/typecheck/unit/build,
  integration, and the full desktop/mobile Playwright gate.
- [x] The CI database job ran `bash scripts/test-db-upgrade.sh` and
  `supabase test db` successfully. Local `npm run test:db` was intentionally
  not rerun in the final pass because it destructively resets the preserved
  local Supabase fixture.
- [x] Fresh local `npm run test:integration`: 3 files / 5 tests against the
  running localhost Supabase stack.
- [x] GitHub CI run `32149626188`: **58/58 desktop + mobile tests passed**
  against the disposable CI fixture with one worker.
- [x] Local `/api/health` returned HTTP 200 with `db: ok`; the running local
  stack reports 98 applied migrations and the expected GitHub/automation/MCP
  tables are present.
- [x] Focused GitHub production shadow run: Chromium + mobile 2/2; local
  personal-pilot readiness unchanged.
- [x] Slack connector smoke test posted and re-read one non-sensitive message in
  `#compliancehub-adtecher-pilot` ([message](https://kt-sme.slack.com/archives/C0BQDARKE4F/p1787049744090669)); this verifies the connected Slack
  destination only, not the ComplianceHub webhook or scheduled digest delivery.
- [x] `npm run test:db:upgrade`: passed earlier in the disposable/local upgrade
  gate (14 upgrade assertions, with the database restored afterwards); it was
  not rerun in this final fixture-preserving pass.
