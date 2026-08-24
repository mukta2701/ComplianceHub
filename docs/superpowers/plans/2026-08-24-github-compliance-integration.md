# GitHub Compliance Integration and Internal-Tool Completion Plan

> **For Codex:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` to execute this plan task by task, with strict `superpowers:test-driven-development` for every behaviour change.

**Goal:** Complete the approved GitHub-first architecture so owner-approved GitHub observations become traceable ComplianceHub evidence and findings, those verified records appear in the web control room and MCP/daily digest, and Slack delivery is fail-closed to one server-approved Mukta destination.

**Architecture:** Keep the existing read-only collector and `runGitHubCollection` phase-1 boundary unchanged. Add a separate post-terminal-run materialiser backed by one atomic, tenant-safe database transaction. The Owner approves an immutable, versioned GitHub-to-ISO mapping pack; only observations processed under that approval can create official evidence/findings. Passing results create immutable superseding evidence, failing results create/reopen one stable finding, and unknown/not-applicable results never make a compliance-positive claim. Existing readiness/SoA/assessment tables are not written by this release. MCP, digest, and web surfaces consume only stored, approved records.

**Tech Stack:** Next.js 16 App Router, TypeScript, React, Supabase/PostgreSQL with RLS and pgTAP, Vitest/Testing Library, MCP SDK, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-17-github-first-compliance-automation-design.md`

## Global Constraints

- The current user-approved rollout scope is Mukta only. Never use, post to, configure, or preserve acceptance claims for Ankit, AdTecher, KT-SME, or another person's Slack/account. The GitHub pilot remains `mukta2701/ComplianceHub` unless Mukta later changes scope herself.
- No production code is written before a covering test is observed failing for the intended missing behaviour. Record RED and GREEN commands/results in each task report.
- `runGitHubCollection` remains phase-1-only and must continue to have no evidence, finding, task, MCP, or Slack dependency.
- Only an active Owner-approved mapping-pack version can materialise observations. Admin, Member, outsider, cross-tenant, stale approval, and direct-RPC bypass attempts are denied.
- Only terminal `succeeded` or `partial` runs can be considered. Each observation is processed independently, but an `unknown` observation never creates/refreshes evidence and never resolves a finding. `not_applicable` remains explanatory only.
- Every official record is traceable to organisation, installation, repository, collection run, observation, check ID, rule version, mapping version, and mapping checksum.
- Evidence is immutable. A newer approved passing observation creates a new evidence record that supersedes the prior GitHub evidence atomically; failed/unavailable collection never extends freshness.
- Findings are unique by organisation + repository + check + mapping version. A newer failure refreshes/reopens; resolution requires a newer, still-fresh matching pass. Task/Issue completion never resolves a finding. Risk acceptance preserves the failed technical state.
- Materialisation must not insert/update/delete `soa_items`, `soa_registers`, assessment tables, risks, or leadership snapshots. Existing readiness percentage must be unchanged before/after materialisation.
- GitHub text is untrusted. MCP, digest, UI, logs, and errors expose bounded safe summaries and stable IDs only; never raw provider response bodies, headers, tokens, source code, or private member data.
- Every new exposed table has RLS, explicit grants, composite tenant foreign keys, and Owner/Admin/Member/outsider/cross-tenant pgTAP coverage. Every `SECURITY DEFINER` function uses `set search_path = ''`, fully qualified names, explicit grants, and validates `auth.uid()` plus workspace role.
- Slack is awareness only. A real delivery is permitted only when the configured webhook's SHA-256 equals the server-only `SLACK_ALLOWED_WEBHOOK_SHA256`; blank/malformed/mismatch fails before decryption reservation, database mutation, or network fetch. Labels and channel names are not trusted identity.
- Tests never call live GitHub or Slack. End-to-end verification uses sanitised injected GitHub observations and a loopback Slack receiver. A real Mukta Slack post remains an explicit external acceptance action and is not inferred from mocks.
- Use `npx supabase migration new <name>` to create migration files. Update every deployment attestation and latest-migration reference to the generated version in the same task.
- Preserve unrelated files and user screenshots. Do not merge or push during task implementation.

## Task 1: Define the versioned standard mapping pack

**Files:**
- Create: `src/features/github/domain/mapping.ts`
- Create: `src/features/github/domain/mapping.test.ts`
- Modify: `src/features/github/domain/rules.ts`
- Modify: `src/features/github/domain/rules.test.ts`

**Step 1: Write failing domain tests**

Add literal, hand-checked expectations proving:

- the standard pack has a stable version, title, SHA-256 checksum, and exactly one mapping for every `EXPECTED_GITHUB_CHECK_IDS` value;
- each mapping includes `checkId`, expected `ruleVersion`, proposed ISO control references, failure severity/remediation, pass treatment, fail treatment, and explicit unknown/not-applicable treatment;
- order changes do not change canonical checksum, while any semantic mapping change does;
- duplicate/missing/unknown check IDs, invalid control references, unsafe/overlong text, and a rule-version mismatch are rejected;
- public repository visibility is a finding only, not positive evidence; archived runtime checks and unavailable checks are explanatory only.

Run `npm test -- --run src/features/github/domain/mapping.test.ts src/features/github/domain/rules.test.ts` and confirm RED because the mapping API is absent.

**Step 2: Implement the smallest pure mapping module**

Export a strict Zod-backed mapping-pack schema, canonical checksum builder, the complete standard mapping pack, and a function that selects a treatment for a `GitHubObservation`. Reuse `RULE_PACK_VERSION` and `EXPECTED_GITHUB_CHECK_IDS`; do not duplicate the check catalogue in a second free-form list.

**Step 3: Verify GREEN and regression**

Run the focused command again, then `npm run typecheck` and focused ESLint for the touched files.

**Step 4: Commit**

Commit as `feat(github): define approved compliance mapping pack`.

## Task 2: Add immutable approval, provenance, and atomic materialisation schema

**Files:**
- Create via CLI: `supabase/migrations/<timestamp>_github_compliance_materialisation.sql`
- Create: `supabase/tests/database/070_github_compliance_materialisation.sql`
- Modify: `supabase/tests/database/008_evidence.sql`
- Modify: `supabase/tests/database/038_monitoring.sql`
- Modify: `.github/workflows/deploy-azure-staging.yml`
- Modify: `src/features/mcp/azure-deployment-contract.test.ts`
- Modify: `docs/deployment.md`
- Modify: `docs/deployment/github-shadow-pilot.md`
- Modify: `docs/release-checklist.md`

**Step 1: Create the migration with the Supabase CLI**

Run `npx supabase migration new github_compliance_materialisation`. Record the generated version and use it everywhere below; do not invent a timestamp.

**Step 2: Write failing pgTAP and deployment-contract tests**

Create pgTAP coverage for:

- immutable versioned mapping packs and mappings;
- one active approval per organisation, Owner-only approval/revocation, and denial for Admin, Member, outsider, and a dual-member targeting a non-active organisation through the application boundary;
- composite tenant ancestry across approval, observation, repository, run, evidence provenance, and finding provenance;
- exact-once materialisation under repeat and concurrent calls;
- pass creates one evidence record and control links; a newer pass supersedes atomically; stale pass cannot refresh;
- fail creates/reopens one finding and updates most-recent detection without duplication;
- only a newer fresh pass resolves a mapped GitHub finding; unknown, not-applicable, stale pass, failed run, task completion, and Issue completion cannot resolve it;
- supported finding states include `open`, `acknowledged`, `in_progress`, `exception_requested`, `risk_accepted`, and `resolved`, with valid audited transitions;
- GitHub task source and finding linkage remain tenant-safe and atomic;
- no materialisation statement touches SoA, assessment, risk, or leadership-snapshot rows;
- grants/RLS deny direct reads/writes outside the intended role boundary.

Update the deployment-contract test first so it fails while the workflow still attests only through the old migration.

**Step 3: Implement the schema and transaction**

Add:

- immutable `github_mapping_packs`, `github_mapping_entries`, and `github_mapping_approvals`;
- immutable `github_evidence_provenance` with stable identity and supersession lineage;
- GitHub provenance columns or a dedicated one-to-one provenance table for `monitoring_findings` that cannot collide with legacy monitor checks;
- `github` as an explicit task source and an atomic finding-task RPC;
- an atomic server-only materialisation RPC that locks the relevant approval/run/identity rows, validates a service-supplied expected checksum/version, and returns bounded created/refreshed/reopened/resolved/skipped counts;
- safe audit events for approval, materialisation, evidence supersession, and finding transitions.

Prefer `security invoker` where RLS is sufficient. Any required `SECURITY DEFINER` function must use an empty search path and explicit fully qualified names. Revoke public/anon access and grant only the minimum required roles.

**Step 4: Align the deployment attestation**

Update the workflow, contract test, deployment guide, pilot worksheet, release checklist, reviewed migration count, and latest-version wording to the generated migration. Do not claim the hosted migration has been applied.

**Step 5: Verify GREEN**

Run the new pgTAP file against a reset local database, then `npm run test:db`, `npm run test:db:upgrade`, the focused Azure contract test, `actionlint`, and `git diff --check`.

**Step 6: Commit**

Commit as `feat(github): materialise approved observations atomically`.

## Task 3: Implement the post-terminal-run materialiser

**Files:**
- Create: `src/features/github/application/materialise-approved-observations.ts`
- Create: `src/features/github/application/materialise-approved-observations.test.ts`
- Modify: `src/features/github/application/collection-deps.ts`
- Modify: `src/features/github/application/collection-deps.test.ts`
- Modify: `src/features/github/application/run-collection.test.ts`
- Modify: `src/app/api/cron/daily/route.ts`
- Modify: `src/app/api/cron/daily/route.integration.test.ts`

**Step 1: Write failing application tests**

Cover real orchestration behaviour with injected database boundaries:

- no approval returns a visible `awaiting_approval` result without writes;
- only terminal completed runs and the active approved pack are loaded;
- observations are schema-validated and mapped in deterministic order;
- the database RPC receives exact organisation/run/pack/checksum ancestry and bounded mapped decisions, never raw API bodies;
- repeat, concurrent, partial, permission-denied, stale, and malformed data have safe explicit outcomes;
- materialisation failure does not change the completed collection run and can be retried independently;
- the daily reconciliation invokes materialisation after collection completes, but a materialisation error is surfaced as collection-health attention and never rewrites the collector result;
- `runGitHubCollection` remains evidence/finding/Slack independent.

Run the focused tests and confirm RED.

**Step 2: Implement the pure application boundary**

Build a small loader/validator/mapper around the Task 1 domain module and Task 2 RPC. Keep GitHub network collection outside it. Return a bounded summary suitable for audit/UI, never raw observation text.

**Step 3: Verify GREEN**

Run focused tests, `npm run typecheck`, and focused ESLint.

**Step 4: Commit**

Commit as `feat(github): reconcile approved compliance results`.

## Task 4: Add Owner approval and official GitHub compliance UI

**Files:**
- Modify: `src/app/app/integrations/actions.ts`
- Modify: `src/app/app/integrations/actions.test.ts`
- Modify: `src/app/app/integrations/page.tsx`
- Modify: `src/features/github/components/github-installation-panel.tsx`
- Modify: `src/features/github/components/github-installation-panel.test.tsx`
- Modify: `src/app/app/evidence/page.tsx`
- Modify: `src/app/app/monitoring/page.tsx`
- Modify: `src/app/app/monitoring/actions.ts`
- Modify: `src/app/app/monitoring/actions.test.ts`
- Modify: `src/app/app/monitoring/page.operator.test.tsx`
- Modify: `e2e/github-shadow-collection.spec.ts`

**Step 1: Write failing action/component/E2E tests**

Prove:

- the Owner sees the proposed pack version, checksum, mapped checks/control references, limitations, and an explicit confirmation before approval;
- Admin/Member see read-only status and cannot call approval/materialisation actions;
- approval is scoped to the exact active organisation and rejects stale version/checksum submissions;
- the repository card clearly distinguishes `Shadow`, `Awaiting approval`, `Official records current`, `Official records stale`, and `Needs attention`;
- results show pass/fail/unknown/not-applicable counts plus evidence/finding links and safe provenance;
- Evidence and Monitoring pages identify GitHub repository, check, observed time, rule/mapping version, freshness, and safe source URL;
- finding controls implement the expanded lifecycle, require reasons where specified, and never offer resolution without fresh passing verification;
- the UI never says GitHub alone proves ISO compliance and never claims readiness improved from mapping;
- desktop and Pixel-mobile E2E seed an approved pack and sanitised terminal run through the real materialiser, assert evidence/finding counts, and assert the readiness percentage is identical before/after.

Run focused tests and confirm RED.

**Step 2: Implement actions and UI**

Use active-workspace server actions, existing capability helpers, rate limits, revalidation, and stable safe error messages. Keep connection/repository selection separate from mapping approval.

**Step 3: Verify GREEN and accessibility**

Run focused Vitest, focused Playwright desktop/mobile, Axe assertions, typecheck, and ESLint.

**Step 4: Commit**

Commit as `feat(github): review official compliance results in the control room`.

## Task 5: Extend MCP reads and daily digest with approved GitHub facts

**Files:**
- Modify: `supabase/migrations/<Task-2-version>_github_compliance_materialisation.sql` only if still uncommitted in Task 2; otherwise create a new CLI migration for the bundle successor
- Modify/Create matching pgTAP coverage after `070`
- Modify: `src/features/mcp/application/mcp-reads.ts`
- Modify: `src/features/mcp/application/mcp-reads.test.ts`
- Modify: `src/features/mcp/domain/digest.ts`
- Modify: `src/features/mcp/domain/digest.test.ts`
- Modify: `src/features/mcp/server/server.ts`
- Modify: `src/features/mcp/server/server.test.ts`
- Modify: `src/features/mcp/application/post-daily-digest.test.ts`

**Step 1: Write failing MCP/digest tests**

Add behaviour coverage for:

- a bounded `list_github_compliance_results` read tool returning only approved official records with stable IDs, repository/check, result, severity, observed/fresh-until, mapping/rule versions, and evidence/finding references;
- workspace role/RLS isolation, unknown/stale distinction, truncation, deterministic ordering, and safe-summary sanitisation;
- a strict versioned compliance bundle including GitHub official counts and important changes since the prior digest;
- digest facts/hash changing for a new official failure, resolution, or newly superseding pass, but not for raw/unapproved shadow observations;
- prepared digest wording distinguishing verified facts, unknowns, stale items, and recommendations;
- numeric and literal validation rejecting hallucinated GitHub claims, source URLs, credentials, raw provider text, or unapproved repository names;
- existing duplicate-safe reservation/finalisation semantics remaining unchanged.

Run the focused tests and confirm RED.

**Step 2: Implement bundle/RPC/read tool/digest changes**

Use stored approved provenance only. Do not call GitHub from MCP or Slack. Bump bundle/digest schema versions deliberately and update every strict parser/consumer together.

**Step 3: Verify GREEN**

Run focused MCP/digest unit and integration tests, typecheck, and ESLint.

**Step 4: Commit**

Commit as `feat(mcp): explain approved GitHub compliance results`.

## Task 6: Fail closed to one server-approved Mukta Slack destination

**Files:**
- Modify: `.env.example`
- Create: `src/features/mcp/application/slack-destination-policy.ts`
- Create: `src/features/mcp/application/slack-destination-policy.test.ts`
- Modify: `src/app/app/integrations/actions.ts`
- Modify: `src/app/app/integrations/actions.test.ts`
- Modify: `src/features/mcp/application/post-daily-digest.ts`
- Modify: `src/features/mcp/application/post-daily-digest.test.ts`
- Modify: `src/features/monitoring/application/deliver.ts`
- Modify: `src/features/monitoring/application/deliver.test.ts`
- Modify: `docs/deployment.md`
- Modify: `docs/release-checklist.md`
- Modify: `docs/codex-overnight-notes.md`
- Modify: `docs/deployment/github-shadow-pilot.md`

**Step 1: Write failing policy tests**

Prove the policy:

- normalises only the already-validated official Slack webhook URL, hashes the exact canonical URL with SHA-256, and compares using timing-safe equality;
- rejects blank, malformed, wrong-length, mismatch, legacy plaintext, and any webhook whose configured digest is absent;
- executes before channel persistence, delivery reservation, audit mutation, or network fetch;
- applies identically to daily digest and monitoring alert delivery;
- exposes only `approved`/`not_approved` status and never the webhook/hash in errors, logs, UI, or client bundles;
- permits a loopback test transport only under `NODE_ENV=test` through an injected transport, never through production URL validation.

Run focused tests and confirm RED.

**Step 2: Implement the server-only allow-policy**

Document `SLACK_ALLOWED_WEBHOOK_SHA256` as blank-by-default and required for all real Slack writes. Do not hard-code Mukta's channel name or secret. Remove old AdTecher/Ankit acceptance claims from active documentation; retain historical entries only when explicitly marked invalid and non-authoritative.

**Step 3: Verify GREEN and secret absence**

Run focused unit/integration tests, build with sentinel server-only values, and scan `.next/static` plus public health responses to prove neither webhook nor hash enters client output.

**Step 4: Commit**

Commit as `fix(slack): restrict delivery to an approved private destination`.

## Task 7: Add restart-safe local pilot and release verification commands

**Files:**
- Create: `scripts/local-pilot-env.sh`
- Create: `src/test/local-pilot-env.test.ts`
- Modify: `package.json`
- Modify: `playwright.config.ts`
- Modify: `src/test/playwright-web-server.ts`
- Modify: `src/test/playwright-web-server.test.ts`
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `docs/deployment.md`
- Modify: `docs/release-checklist.md`

**Step 1: Write failing executable-contract tests**

Use temporary fake env/status inputs to prove the launcher:

- fails before startup unless Supabase is exact loopback and all public/admin keys come from the same local stack;
- requires a valid 32-byte base64 `APP_ENCRYPTION_KEY` without printing it;
- loads GitHub pilot credentials only from an ignored local file, validates App/client/origin fields, and never echoes private key/client secret;
- refuses hosted Supabase, missing Slack allow hash for real delivery, unresolved placeholders, or mixed local/hosted configuration;
- starts the production standalone server for release E2E and serialises local workers while keeping CI's explicit safe cap;
- leaves provider-dependent features visibly disabled rather than silently using sample/live third-party data.

Run the focused tests and confirm RED.

**Step 2: Implement launcher and package scripts**

Add `pilot:check`, `pilot:dev`, `test:e2e:prod`, and `verify:release` commands. The release aggregate must include lint, typecheck, unit tests, production build, DB reset/pgTAP, DB upgrade, integration tests, and production-server Playwright with one local worker. Use a deterministic standalone asset-copy/start wrapper already present in the release branch.

**Step 3: Verify GREEN**

Run focused launcher/config tests, `bash -n`, `shellcheck`, and a no-secret output check.

**Step 4: Commit**

Commit as `chore(dev): make the internal-tool pilot restart safe`.

## Task 8: Prove GitHub → ComplianceHub → MCP → digest end to end

**Files:**
- Create: `e2e/github-compliance-internal-tool.spec.ts`
- Create: `src/features/mcp/application/github-digest-flow.integration.test.ts`
- Create: `docs/deployment/github-compliance-internal-tool-proof.md`
- Modify: `docs/release-checklist.md`
- Modify: `docs/codex-overnight-notes.md`

**Step 1: Write the failing acceptance scenario**

The scenario must use the real local Supabase persistence and application routes with sanitised injected GitHub facts:

1. Sign in as the local Owner and select only `mukta2701/ComplianceHub` fixture scope.
2. Record readiness percentage and official evidence/finding counts.
3. Complete a terminal shadow collection containing pass, fail, unknown, and not-applicable observations.
4. Confirm no official records exist before Owner mapping approval.
5. Approve the exact pack version/checksum and materialise once.
6. Assert official evidence and one deduplicated finding with complete provenance; readiness percentage is unchanged.
7. Replay and race the materialiser; counts remain stable.
8. Query the real local MCP handler as an authorised user and verify exact safe GitHub result counts/references.
9. Prepare the real digest facts, post through a loopback Slack receiver, compare every number with the fact bundle, and prove duplicate delivery is blocked.
10. Add a newer failing observation to reopen, then unknown to prove no resolution, then a fresh pass to resolve and supersede evidence.
11. Run the same visible flow on Chromium desktop and Pixel-mobile projects with accessibility checks.

Run discovery/focused tests and confirm RED for the missing integrated path.

**Step 2: Add only test adapters/fixtures required for the acceptance path**

Do not add alternate production logic or bypass RLS/RPCs. The injected transport may replace only live GitHub/Slack network calls; all evaluation, approval, persistence, MCP, digest, and UI code must be real.

**Step 3: Verify the full release matrix**

From a clean local-only environment run, in order:

```bash
npm run verify
COMPLIANCEHUB_ALLOW_LOCAL_DB_RESET=1 npm run test:db
COMPLIANCEHUB_ALLOW_LOCAL_DB_RESET=1 npm run test:db:upgrade
npm run test:integration
npm run test:e2e:prod -- --workers=1
git diff --check
```

Also run `actionlint`, `shellcheck` for changed scripts/workflows, scan the production client bundle for server-only secrets, and record `/api/health`, `/mcp` unauthorised challenge, protected-resource metadata, authenticated MCP tool result, desktop/mobile screenshots, and loopback digest payload hash.

**Step 4: Document exact evidence**

The proof document records the reviewed commit SHA, commands, counts, screenshots, safe fixture IDs, and unresolved external gates. It must clearly say that no real Slack message, hosted migration, Azure deploy, or third-party account change occurred unless separately proven.

**Step 5: Commit**

Commit as `test(release): prove the ComplianceHub internal-tool flow`.

## Task 9: Final whole-branch review and handoff

**Files:**
- Modify only files required by the final review fix wave.

**Step 1: Run the Subagent-Driven Development whole-branch review**

Review the complete range from `be0d0a1` to HEAD against the approved spec and this plan. Treat security, tenant isolation, idempotency, stale/unknown semantics, fact/digest accuracy, secret handling, and misleading UI claims as release-blocking.

**Step 2: Run one reviewed fix wave**

Send all Critical/Important findings to one fresh implementer, then one scoped re-review. Record any rulings in the SDD ledger.

**Step 3: Re-run affected and full verification**

Repeat the full Task 8 release matrix on final HEAD. Do not reuse pre-fix evidence.

**Step 4: Present the branch without external mutation**

Use `superpowers:finishing-a-development-branch`. Do not merge, push, deploy, apply hosted migrations, generate new GitHub secrets, or send a real Slack message without the action-time security/external-write approval required by the platform. Clearly separate locally complete functionality from owner-controlled hosted acceptance.

