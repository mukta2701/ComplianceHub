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

1. [x] Package intended audited source, tests, migrations and documentation into reviewed commits; initial candidate `8785a4fa84e30b5596763068b00a03848a15d282` tagged `demo-rc-20260905-1`. Later demo/security fixes require an updated final release SHA.
2. [x] Add a fictional showcase through supported workflows; prove reruns preserve IDs/counts and historical data.
3. [x] Rehearse an identified production build/database in Browser on desktop/mobile, including restart, refresh, errors, loading and permissions.
4. [x] Verify auditor-link database limits, Jira credential grants, observability storage failure and dependency advisories.
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

### Active production rehearsal

- Demo tooling and evidence risk/task choices committed as `18babf170c830e238a3533c97e8555616413d186`. Focused tests: 5 files, 18 tests pass (launcher/setup guards plus Member/provenance/restoration evidence tests); typecheck and scoped lint pass.
- `npm run demo:build` succeeded; `npm run demo:start` runs the standalone production server at `http://127.0.0.1:3100`. `/api/health` returns `status: ok`, `db: ok`, release `18babf170c830e238a3533c97e8555616413d186`. Build metadata is `.next/local-demo-build.json`, applied migration `20260904220000`, API `http://127.0.0.1:54321`. This rehearsal includes two uncommitted setup-ordering lines and a pending DB test cleanup fix; it is not final exact-clean-release acceptance.
- Initial Browser inspection confirmed the production sign-in form renders. Showcase setup is creating the dedicated Northstar workspace through signup, application actions and assessment APIs. No real provider credentials or notifications are enabled.
- Diagnostic restored database `compliancehub_release_verify_20260905b` preserves the raw snapshot data, temporarily loaded the orphan audit FK as NOT VALID, then restored remaining objects. The initial restore stopped before its late archive permission grants; the archive does contain those grants. Resuming them restored application access, with one remaining Supabase GraphQL bootstrap-function mismatch. This diagnostic clone is not accepted as full clean-restoration proof.
- A narrowly scoped correction to test 071 cleanup removes only its exact synthetic organisation audit rows. Executing the cleanup portion in the diagnostic clone left zero orphan audit events and allowed FK VALIDATE to succeed. Original `postgres` database has not received this cleanup. Focused test 071 on the diagnostic clone passed 76 assertions. A separate correctly bootstrapped Supabase stack now provides the full-suite proof below.

- Fresh isolated Supabase project `compliancehub-release-1788565333-9540`, DB port `45402`, applied the complete migration chain and passed **93 files / 1,926 assertions**. Exact proof: `artifacts/release-2026-09-05/fresh-database-full.log`. The earlier helper output ending `NOTESTS` is preserved and explicitly rejected; the helper now requires positive file/test counts and PASS. Neither stack was reset.
- Browser found and reproduced mobile evidence overflow (390px viewport, 589px document width) and policy evidence mislabelled `Task: undefined`. Targeted rendering fixes are prepared; 3 evidence suites / 9 tests pass. Actual fixed production-browser verification is pending rebuild.
- Rehearsal build `82ec413` was rejected by the source identity guard because a script edit landed during compilation; it is not accepted. Clean build `9ae10be366ba19838ffdc203e335567eebd62eec` succeeded and is serving production on port 3100 (source hash `4fae81800d2c9f095b3b5ac83ec9e4cce0ee8c05d0f4f5ad6f260b2f955617e8`, local migration `20260904220000`). Later setup/test-only refinements are pending final release rebuild.
- Actual Browser on build `9ae10be`: evidence policy label reads `Policy: NS-POL-001: Northstar access review policy`; mobile viewport/document widths both 390px. Risk-register → treatment-task navigation shows the same owner, due date, risk and evidence. Audit and leadership report render within 390px. Finalised SoA/report verification is still pending setup completion.
- Clean isolated recovery proof: dump SHA-256 `15ce95131f9c626ba2b227e626af748fce75478a4c083ffcb767a6444ce31905`, zero orphan audit events. Restore into **new** DB `release_restore_20260905b` in the retained fresh container required login as local `supabase_admin`, restoration of the source GraphQL bootstrap wrapper, then remaining ACL/default grants/event triggers. All **117** public/auth/assessment/migration tables match exact row fingerprints. Proof files `fresh-{source,restored}-data-fingerprints.txt`, `graphql-bootstrap.sql`, `fresh-restore-finish.{list,log}`. This proves a clean local database restoration with explicit bootstrap steps; it does not repair/certify the original historical dump or a hosted backup.
- Local resource issue observed: Realtime restarted repeatedly (24 observed restarts, browser WebSocket 502) while three temporary test projects shared a 2GB Colima VM. Completed temporary auth/Kong services and two failed-start test databases were stopped without deletion; the main demo and retained fresh regression database remain running. Verify Realtime stability before final browser acceptance.

### Showcase and security acceptance

- Northstar Demo — Showcase v1 (`2960769e-ff23-427a-9d66-eec278518882`) now has one completed assessment with 10/10 answers, 93 reviewed SoA controls and an immutable v1, one medium risk, one owned treatment/task, two current evidence records with 97 links, one approved policy, one audit/checklist/finding and one published leadership snapshot. Normal setup rerun and verify-only preserve exact IDs, counts and row fingerprints. `showcase-idempotency.json` records unchanged historical CEO rows, fixture source and proof artifact. Private local manifests and sessions remain ignored under `artifacts/showcase-v1/`.
- Build `9ae10be` browser rehearsal demonstrated the connected journey, correct evidence labels and mobile width; Member tests passed on desktop and mobile. Harness-only failures (inherited owner cookies in the anonymous context, ordinary cancelled navigation/download requests) were corrected. Final exact-version run remains pending. Throttled browser showed **Loading monitoring** before rendering; unknown risk showed Page not found and recovery navigation, unknown SoA PDF returned 404. Evidence: `loading-error-proof.json`, `member-browser-proof.json`, screenshots and retained browser logs.
- SoA PDF/DOCX labels now explain that immutable snapshots contain manual references, while linked evidence remains in the workspace vault. Existing snapshot contents are preserved. Earlier PDF page renders were checked; updated final export rendering remains pending.
- Jira gap reproduced: ordinary/anonymous roles could execute three credential RPCs. New migration `20260905010000` restricts each exact signature to service_role. Real-role regression: before 15/21 failed, after 21/21 passed. No actual credential contents were read. Logs `jira-credential-grants-{before,apply,after}.log`.
- Auditor RPC now reserves atomic database budgets before access logging/aggregation: 300 calls/minute globally and 30/minute per issued token. Null/empty/over-256-byte tokens are rejected early; unknown tokens cannot create arbitrary per-token rows. Exhaustion returns null so its counter transaction commits. Exact old function replay failed 8/17 assertions; new and compatibility tests passed 3 files / 39 assertions. Logs `auditor-old-function-repro.log`, `auditor-limits-after-local.log`. Limits do not provide pagination, retention, or upstream network-level denial-of-service protection.
- Observability now fails closed with 503 when durable counters fail, return invalid values, or lack configuration; no fallback or error writes occur on that path. Normal exhaustion returns 429; legitimate reports still work. Real limiter + route regression and existing tests: 3 files / 26 pass. Other callers retain their existing fallback behavior. Independent Astra candidate review found no actionable regression; reviewer independently executed those 26 tests, but did not independently rerun SQL/concurrency tests.
- Both security migrations applied only to identified LOCAL main and isolated test stacks, now 127 migrations through `20260905011000`. Hosted databases remain unchanged. Migration logs preserved.
- Browserslist updated 4.28.4 → 4.28.9 with required browser-data dependencies, resolving [query-cache advisory](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) and [custom-statistics advisory](https://github.com/advisories/GHSA-73wf-gq98-2v4g). Final npm audit: 0 high/critical, 2 moderate package entries (ExcelJS and its UUID dependency, one underlying [UUID advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq)). ExcelJS's identified calls use UUID v4, which the advisory explicitly excludes. A forced major override was not adopted; this remains a dependency limitation requiring upstream tracking, not a claim of a clean audit.

- Final source gate: lint/typecheck pass; **286 unit files / 2,415 passed / 3 skipped**, **95 SQL files / 1,964 assertions passed** on the isolated database after all 127 migrations. Exact logs `final-{lint,typecheck,unit,database}.log`. No full-suite replay was performed on the historical main database.

### Staging approval packet — blocked target, no hosted changes

- Intended runbook target: Azure app `ca-compliancehub-staging`, resource group `rg-compliancehub-staging-uks`, UK South; hosted Supabase runbook ref `ytenjiyjdcrjkgwmciqw`. Current `.env.local` instead names `etpiqjbehbchkkzmbjzt`. Read-only Azure lookup returned ResourceGroupNotFound in the authenticated subscription; unrelated apps are not substitute targets. Exact destination, live release/image/revision and backup remain unverified. Target clarification remains pending.
- Proposed database changes, subject to exact hosted migration inventory/dry-run: nine ordered migrations after `20260825124025`: `20260904201754`, `20260904201759`, `20260904210402`, `20260904210426`, `20260904210742`, `20260904220000`, `20260905010000`, `20260905011000`, `20260905012000`. They cover assessment/treatment workflow guards, Jira enum/lifecycle, durable alert delivery, membership compatibility the two security fixes and backend-only export audit appends. No hosted list/dry-run/application has been claimed.
- Before approval: identify target and canonical origin, capture the active image digest/revision/traffic and secret-reference names, verify a recoverable hosted backup and restore procedure, compare schema history and dry-run, and replace the deployment workflow's old migration attestation only with the reviewed target checkpoint. Native Jira stays unavailable unless its server-only client ID/secret are deliberately configured; existing Azure secret mapping does not include them. Outbound Slack/email/provider delivery remains disabled for this demo.
- Deployment approval must name the exact tested release SHA/image, Azure target, Supabase project and ordered migrations, expected downtime and rollback predecessor. The existing automatic main workflow is not used: no push/merge/deploy is authorized. After approval, migrate in order, verify grants/schema, deploy the immutable version, require health `status: ok`/`db: ok` with exact SHA and migration, then repeat the connected journey and Member/anonymous checks at the canonical staging URL.
- Rollback: route traffic back to the captured healthy immutable revision with its matching secret references, confirm its health/release and critical journey. Container rollback does **not** reverse database migrations; these changes require compatibility verification with the predecessor. If database recovery is necessary, restore the verified backup into a separate environment and validate before any approved cutover. Never run destructive down-migrations or restore over existing data as an automatic recovery action. Current predecessor and hosted recovery are unknown, so deployment is blocked.

- Acceptance caught a production-only export audit failure despite the four browser tests passing: `service_role` lacked INSERT on `audit_events`. Migration `20260905012000` grants append only; ordinary users cannot forge events, UPDATE/DELETE remain ungranted and immutable triggers remain active. Regression reproduced 4/8 failing assertions before and 8/8 pass after. Four real export downloads changed the fictional workspace export-event count from 0 to 4. Independent review found no actionable concern and independently passed 4 export unit tests. Focused lint/typecheck pass. Both local databases now have 128 migrations; no hosted change.
- Actual Browser rechecked assessment 10/10, all 93 SoA controls reviewed, the linked medium risk/owned December-31 task/evidence, tested audit and report (89% readiness, 1 task, 2 current evidence, 1 medium risk, 1 audit). SoA PDF first-page rendering verifies the manual-reference explanation and preserved snapshot content. Main Realtime has remained at restart count 25 since 00:09:27 UTC after test-service memory pressure was removed.

### Reproducible local release

- Release reference: annotated tag **`demo-rc-20260905-2`**. Resolve its exact commit with `git rev-parse demo-rc-20260905-2^{commit}`. The tag includes the final code and these operator documents; no main merge, push or deployment is part of acceptance.
- Final application source `e8a806be483fa77c54f8e68629adeb6ea3f30cb2` passed production compilation and all **4 connected desktop/mobile and Member browser tests** (`export-fixed-showcase-e2e.log`), with no export audit errors. Restarting that same standalone build preserved the session/data and returned healthy DB/release identity. Throttled loading, recovery navigation, refresh, missing-export 404 and actual DOCX download passed (`final-boundary-proof.json`). The documentation-only release commit is rebuilt and checked again; authoritative final SHA/environment/results are saved in `artifacts/release-2026-09-05/release-acceptance.json` and `.next/local-demo-build.json`.
- Test totals are intentionally not conflated: the full baseline after security fixes passed 2,415 unit tests and 1,964 SQL assertions; the subsequent append fix passed its focused **4 unit / 8 SQL** checks, lint/typecheck, production build and four browser tests. The three skipped baseline unit tests remain skipped. Full expensive suites were not repeated for documentation.
- Startup, five-minute walkthrough, private synthetic credential location and recovery instructions: [demo-release.md](demo-release.md). Demo URL `http://127.0.0.1:3100`; database `compliancehub` at `http://127.0.0.1:54321`, migration `20260905012000` (128 applied migrations). Staging remains **unverified and not deployed** pending exact target, backup/dry-run evidence and explicit approval.
