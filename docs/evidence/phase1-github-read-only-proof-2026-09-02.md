# Phase 1 evidence — GitHub read-only connection and repeatable scan

Date: 2026-09-02
Phase: 1 only
Verdict: `GO` — live proof passed, independent review approved, and supervisor closure passed

## Connection verified

- GitHub App: `ComplianceHub Mukta Local Pilot` (`4629430`)
- Installation: `154509880`
- Test account: `mukta2701` (`User`, explicitly allowed only for the loopback development pilot)
- Repository selection: `Only select repositories`
- Selected repository count: `1`
- Selected repository: `mukta2701/ComplianceHub`
- GitHub permission level: `Read`
- Read scopes shown by GitHub: Dependabot alerts, Actions, administration/settings metadata, repository metadata, secret-scanning alerts, and security events

Visual evidence: [GitHub installation and selected repository](./phase1-github-installation-2026-09-02.jpg)

## Live two-run proof

- Local target identity: `supabase_db_compliancehub`
- Proof mode: `shadow`
- Proof file mode: `0600` (owner-only)
- Run 1: `partial`, 15 observations, 8 pass, 5 fail, 2 unknown, 0 materialisation jobs
- Run 2: `partial`, 15 observations, 8 pass, 5 fail, 2 unknown, 0 materialisation jobs
- Distinct observation keys: 15 in each run
- Duplicate `(run, observation key)` pairs: 0
- Stable compliance semantics matched: `true`
- Repository fingerprint before/between/after matched: `true`
- Protected official state before/between/after matched: `true`
- Proof redaction scan: `PASS`
- Stable semantics SHA-256: `68be8032c0a13f45b1c6ab0c80890d11a89a75417fd52e1a02fce84714ce9130`

The two unknown checks are explicit rather than hidden:

- Code scanning: GitHub returned `not_found`.
- Dependabot alerts: GitHub returned `permission_denied`.

These make the result truthfully `partial`; they do not invalidate the read-only or repeatability proof.

## Read-only network ledger

- Total GitHub API requests: 49
- Installation-token mint: one required `POST` to `/app/installations/{installation_id}/access_tokens`
- Repository operations: 48 requests, all `GET`
- Repository write requests: 0

## No downstream side effects

The protected-state hashes were identical before, between, and after both scans for:

- materialisation jobs;
- official compliance results;
- evidence and findings;
- readiness, Statement of Applicability, assessments, risks, and tasks;
- mapping approvals;
- MCP digest state; and
- Slack deliveries.

## Verification commands

- Repository type-check: `PASS`
- Focused Phase 1 lint: `PASS`
- Focused Phase 1 unit/integration suite: 9 files, 167 tests, `PASS`
- Phase 1 database boundary test `077_github_shadow_run_boundary.sql`: 19 tests, `PASS`
- Independent code review: `APPROVED` after midpoint repository-state and final protected-state regression tests were added

The full database suite passes through the Phase 1 boundary and then stops in later MCP test `079_mcp_github_official_results_v2.sql`, because the later untracked MCP migration `20260902151659` is not applied. That is recorded for the MCP phase and was not applied while Phase 1 was locked.

## Source under review

- `src/features/github/application/github-shadow-proof.ts`
- `src/features/github/application/github-shadow-proof.test.ts`
- `src/features/github/application/github-shadow-proof-local.ts`
- `src/features/github/application/github-shadow-proof-cli.ts`

The legacy `scripts/local-github-repeatability.ts` was not run because it can perform official materialisation and is outside the Phase 1 read-only boundary.
