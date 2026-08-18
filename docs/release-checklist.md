# Public beta release checklist

- [ ] Project owner has reviewed and approved every assessment question and remediation.
- [ ] Legal, privacy, certification, and open-source disclaimers are visible and accurate.
- [ ] Production Supabase project uses the intended region and all migrations pass.
- [ ] Hosted Supabase personal staging project ref `ytenjiyjdcrjkgwmciqw` has a verified backup; `supabase migration list` and `supabase db push --dry-run` showed exactly GitHub migrations `20260817010000`, `20260817020000`, `20260817030000`, and `20260817192458` in order; they were verified before any application deployment; and `HOSTED_SUPABASE_PROJECT_REF` plus `HOSTED_SUPABASE_MIGRATION_VERSION` were set only afterwards and match `NEXT_PUBLIC_SUPABASE_URL`.
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

- [x] `npm run verify`: lint, typecheck, 173 test files / 1,291 tests, and Next production build.
- [x] `npm run test:db`: 66 pgTAP files / 1,170 tests.
- [x] `npm run test:integration`: 3 files / 5 tests against the running localhost Supabase stack.
- [x] `npm run test:e2e` with CI-equivalent local secrets, `E2E_TEST_TOOLS_ENABLED=1`, production build, and two workers: 56/56 desktop + mobile tests.
- [x] Focused GitHub production shadow run: Chromium + mobile 2/2; local personal-pilot readiness unchanged.
- [x] `npm run test:db:upgrade`: passed earlier in the disposable/local upgrade gate (14 upgrade assertions, with the database restored afterwards); it was not rerun in this final fixture-preserving pass.
