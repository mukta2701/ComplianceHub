# Public beta release checklist

- [ ] Project owner has reviewed and approved every assessment question and remediation.
- [ ] Legal, privacy, certification, and open-source disclaimers are visible and accurate.
- [ ] Production Supabase project uses the intended region and all migrations pass.
- [ ] Hosted Supabase personal staging project ref `ytenjiyjdcrjkgwmciqw` has a verified backup; `supabase migration list` and `supabase db push --dry-run` showed exactly the twenty-four reviewed migrations through `20260825124025` in order; migrations 1–19 were verified before the manual bridge, additive migrations 20–24 were verified before final, and the phase-specific `HOSTED_SUPABASE_MIGRATION_VERSION` always matched `NEXT_PUBLIC_SUPABASE_URL`.
- [ ] Cross-tenant RLS tests, immutable-record tests, and stale-write tests pass.
- [ ] Service-role and cron credentials are server-only, rotated, and stored in deployment secrets.
- [ ] Mukta has verified one Mukta-owned, server-approved private Slack destination; its canonical webhook SHA-256 is stored only in `SLACK_ALLOWED_WEBHOOK_SHA256`, the A/B secret references are coherent, and blank/malformed/mismatched/legacy configurations fail without a Slack write.
- [ ] The staged Slack rollout completed in order: manual `bridge` on migration `20260825040825`, health capability `v1`/`bridge` with the exact release SHA, additive migrations `20260825053718`, `20260825073650`, `20260825082411`, `20260825094343`, and `20260825124025`, then manual `final` in `strict` mode. The first final followed the exact bridge revision; in steady-state operation, subsequent manual final and automatic runs stayed strict while accepting only an exact `v1` predecessor whose captured mode was `bridge` or `strict`. Final had exact same-slot Slack/core references, and rollback was pinned to the captured revision/image/references and matched its exact previous mode and release SHA.
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

## Demo release continuation — 2026-09-05

This is the active release checklist. Earlier checked audit items are historical
evidence, not acceptance of this release. Continue from the audit and branch
reconciliation documents; preserve unfinished branches and the frozen CEO fixture.

1. [ ] Package intended source, tests, migrations and documentation into reviewed commits; record candidate SHA.
2. [ ] Add a fictional showcase through supported workflows; prove reruns preserve IDs/counts and historical data.
3. [ ] Rehearse an identified production build/database in Browser on desktop/mobile, including restart, refresh, errors, loading and permissions.
4. [ ] Verify auditor-link database limits, Jira credential grants, observability storage failure and dependency advisories.
5. [ ] Prepare exact staging target, migration/backup/health/rollback evidence; request approval before hosted changes; deploy and rehearse only after approval.

### Release evidence and decisions

- Starting source: `dcded8801bd57657702bd91f91b5306004b673c4`, branch `codex/compliancehub-internal-tool`; current audited changes were uncommitted. Work continues in this existing checkout to preserve unfinished changes.
- Initial tracked patch, untracked archive and SHA-256 inventory saved locally under `artifacts/release-2026-09-05/`; historical screenshots remain in place.
- Historical fixture source SHA-256: `9eaa52b99a43f3a99afdc8893a4e6292e7e4bf91e0ed7a38f3220e8716992bef`. Its incomplete completed assessment is a preserved historical limitation.
- Existing `.env.local` targets hosted Supabase `etpiqjbehbchkkzmbjzt` and a stale `http://localhost:3000` origin. Do not use implicitly for demo build/testing. No environment files or hosted data changed.
- Selected local demo database: Supabase project/container `compliancehub` / `supabase_db_compliancehub`, API `http://127.0.0.1:54321`, PostgreSQL port `54322`; observed 125 migrations through `20260904220000`. Dedicated fictional workspace will isolate showcase records.
- App port `3100` was not serving at initial inspection. Runtime versions: Node `25.6.1`, npm `11.9.0`.
- Do not run `scripts/test-db-isolated.sh` or `test-db-upgrade.sh`: both invoke resets. Fresh migration compatibility must use a newly created disposable database without resetting existing databases.
- Fresh verification: lint and typecheck exit 0; unit tests 281 files / 2,384 passed / 3 skipped; local pgTAP 93 files / 1,925 assertions passed. Logs: `artifacts/release-2026-09-05/{lint,typecheck,unit,database}.log`. Production build/browser evidence remains pending.
- The historical fixture `--verify` fails its guarded preflight; source remains unchanged. Diagnose without applying the fixture. The DB suite includes four concurrency suites with committed synthetic IDs and cleanup, so further full database runs will use a separate database; it is not wholly rollback-only.

- Historical verification recovered: copied only the missing proof artifact from the preserved checkout after matching SHA-256 `79e66498f58fee76966e9119fbd138911dbc8b2c8f5ac1775e423ed8e9449a30`; read-only verification passed with 30 records and zero added audit events. Fixture hash `d5eb0304d81e6ec00051490a405abe5c18b6d8f42f00f4c9bd0929f68a95454c`.
- Local pre-showcase backup: `artifacts/release-2026-09-05/local-before-showcase.dump`, SHA-256 `e3f0bec63005c5de7d57de0f33853f9945537fe2baa67b24d0ed0cfee60679c9`; archive listing readable (2,556 lines). This proves archive readability, not yet restoration.
- Scope correction: policy feedback threads/replies/resolution and leadership publication to workspace Members are present. Private feedback notifications, policy-to-control mappings, and selected external leadership recipients/revocation remain preserved unfinished ports; the earlier reporting check does not prove these shipped.
- Staging target clarification pending: historical Azure runbook names Supabase `ytenjiyjdcrjkgwmciqw`, current environment names `etpiqjbehbchkkzmbjzt`. No hosted writes approved.

- Release commit groups prepared: core `cbf48e5`, API/export `8a3738e`, native Jira + durable alerts `9e1ee69`, membership compatibility `c26b5d0`, retained verification tooling `349d671`. Native provider configuration and database credential-grant validation remain separate gates.
- Backup restoration exposed a real historical data-consistency issue: orphan `audit_events` for synthetic `72000000…` test organisations cause foreign-key recreation to fail. The existing concurrency test cleanup disables referential triggers and can leave these audit rows. No existing data was repaired/deleted; raw backup and partially restored diagnostic databases remain preserved. Full suite reruns must be confined to a separate database. Recovery is not yet certified.
