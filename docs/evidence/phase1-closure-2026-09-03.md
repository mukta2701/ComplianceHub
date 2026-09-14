# Phase 1 closure — local GitHub monitoring website

Date: 3 September 2026 (Europe/London)

Verdict requested: Phase 1 only. MCP hosting/migration work, Slack delivery, Jira, mobile-specific work, organisation rollout, Azure, and production deployment are explicitly outside this gate.

## Runtime

- Local site: `http://127.0.0.1:3100`
- Application health: `ok`
- Database health: `ok`
- Supabase database and authentication containers: healthy
- The stopped-site symptom was environmental: no Next.js process was listening. No Phase 1 application defect was required to restore it.

## Fresh live GitHub proof

The approved local private GitHub App was used against the one selected personal-pilot repository. The private key remained a mode-`0600` local file and was loaded only into the server/proof process.

- Run mode: `shadow` / read-only proof
- Runs: 2
- Result per run: `partial`
- Observations per run: 15
- Unknown checks per run: 2
- Materialisation jobs created: 0
- Repeatable compliance meaning: true
- Repository fingerprint unchanged: true
- Protected ComplianceHub state unchanged: true
- GitHub requests: 49 total
- Required installation-token mint: 1 `POST`
- Repository operations: 48, all `GET`
- Repository write operations: 0
- Stable-semantics SHA-256: `68be8032c0a13f45b1c6ab0c80890d11a89a75417fd52e1a02fce84714ce9130`

The two explicit unknown checks remain GitHub code scanning (`not_found`) and Dependabot alerts (`permission_denied`). They make the scan honestly partial; they do not weaken the read-only or repeatability proof.

## Database-to-website truth

```json
{"active_installations":1,"selected_repositories":1,"unresolved_findings":5,"open_findings":2,"acknowledged_findings":3,"official_history":45,"latest_official_results":15,"pass":8,"fail":5,"unknown":2}
```

The Monitoring page counts unresolved findings, so its five active findings correctly consist of two open findings plus three acknowledged findings. Acknowledgement does not resolve or hide an issue.

## Fresh verification

- Full Vitest suite: 236 files passed; 1,921 tests passed; 1 intentionally skipped.
- Phase 1 database boundary: 19/19 pgTAP checks passed.
- TypeScript: passed.
- Full ESLint: passed.
- Patch integrity (`git diff --check`): passed.
- Next.js production build: passed; all 29 static pages generated and the dynamic Monitoring/API routes compiled.
- Desktop Chromium Phase 1 end-to-end test: 1/1 passed.
- Isolated staged Phase 1 snapshot: 234 test files and 1,882 tests passed; type-check, lint, and production build passed using a clean dependency install.
- Implementer closure audit: no Phase 1 defect found and no code changes required.
- Independent reviewer verdict: `APPROVED`; no functional, security, or desktop website blocker remains.
- Supervisor verdict: `GO`; health, database counts, two-run shadow proof, read-only ledger, website evidence, and verification results reconcile.

## Visual evidence

- `phase1-monitoring-desktop-after-2026-09-02.jpg` — authenticated Owner Monitoring overview at 1440 × 900.
- `phase1-monitoring-findings-desktop-2026-09-02.jpg` — authenticated plain-language findings and collapsed technical evidence.
- `phase1-github-installation-2026-09-02.jpg` — GitHub App installation and one selected repository.

## Phase boundary

Passing this gate means the local desktop website can display and explain repeatable read-only GitHub compliance results for the selected personal pilot repository. It does not claim the later hosted MCP, organisation GitHub, Slack, scheduling, or production rollout phases are complete.

Any broader GitHub installation/repository scope or any GitHub write permission requires a new human approval gate.
