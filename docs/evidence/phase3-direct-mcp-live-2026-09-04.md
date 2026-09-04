# Phase 3 direct MCP live proof — 4 September 2026

## Result

`DIRECT_MCP_OK workspaces=1 github_results=5`

The proof used a fresh, ephemeral Codex process connected directly to the
`compliancehub-local` MCP server at `http://127.0.0.1:3100/mcp`. The process
did not use the separately registered `codex_apps` connector.

## Live checks

- OAuth approval completed with `openid`, `profile`, `email`, and optional
  `offline_access`. No phone or write scope was requested.
- `list_workspaces` returned one accessible workspace:
  `ComplianceHub Local Demo` with the `owner` role.
- `list_github_compliance_results` returned five current approved records from
  the stored official GitHub collection run.
- The page included a passing secret-scanning check and active findings for
  workflow security and branch-review controls.
- The CLI process exited successfully after emitting the exact result above.

After stale local proof grants were revoked, a second fresh process proved the
retained Codex session and the Monitoring reconciliation:

`DIRECT_FINDINGS_OK count=5 high=3 medium=2`

The MCP returned the same five open findings shown in the web app: repository
visibility, security workflow, approving-review count, stale approvals, and
code-owner review.

A leadership-style question was then run through four read-only tools:
`get_compliance_overview`, `list_attention_items`,
`get_latest_leadership_report`, and `prepare_daily_digest`. Codex returned a
plain-English current position, immediate priorities, next actions, data-age
warning, truncation warning, and preview-only digest. It ended with:

`CEO_MCP_DEMO_OK tools=4 writes=0`

The live response reported 43% readiness, three open tasks with one overdue,
one open audit, one open non-conformity, eight expiring evidence items, five
current GitHub failures, and two unknown GitHub checks. It explicitly stated
that the digest was prepared for preview and not delivered by Phase 3.

## Read-only boundary

The configured connector enables exactly these seven read tools:

1. `list_workspaces`
2. `get_compliance_overview`
3. `list_attention_items`
4. `list_monitoring_findings`
5. `list_github_compliance_results`
6. `get_latest_leadership_report`
7. `prepare_daily_digest`

`post_daily_digest` is explicitly disabled. This proof performed no GitHub,
Slack, or ComplianceHub write.

The Settings screen was also reduced from 13 active local OAuth grants to the
single current Codex connection by revoking 12 stale Phase 2/Phase 3 proof
sessions through the application. The retained Codex grant was then used for
the second successful direct call above.

After the local demo password was reset, the old grant and local token were
both explicitly revoked, followed by one clean OAuth login. Two separate fresh
Codex processes then completed `compliancehub-local/list_workspaces` with no
tool error and returned `Found 1 accessible workspace.` This leaves one active
remote grant and one clean local connector credential for the demo.

## Visual cross-check

The authenticated `/app/monitoring` screen showed the same local demo
workspace, the connected `mukta2701/ComplianceHub` repository, five active
findings, their severity, plain-language explanation, recommended action,
ISO references, observation time, and current-through time.

## CEO journey smoke test

An authenticated browser loaded every primary demo route from the running
port-3100 application. Dashboard, Gap assessment, Risk register, Statement of
Applicability, Evidence, Tasks, Monitoring, Policies, Internal audits,
Performance, Leadership report, Connections, and Settings all rendered their
expected main heading with no application or server error. A warm recheck of
the initially slowest pages loaded Leadership report in 811 ms and Settings in
1,657 ms in the local development runtime.

The ordinary local owner credential was reset only in local Supabase Auth and
verified through both the public password-authentication client and the real
browser sign-in form. The browser reached `/app` as Owner for ComplianceHub
Local Demo. No password or service-role value is stored in source or this
evidence artifact.

## Final fresh-scan proof

A second real read-only collection was run against the installed
`compliancehub-mukta-local-pilot` GitHub App and the selected
`mukta2701/ComplianceHub` repository. The scanner checked one installation and
one repository, stored 15 observations, and completed with no repository
failure or deferred repository. Protected GitHub state had the same SHA before
and after the collection.

The newest official result set contains exactly 15 checks: eight pass, five
fail, and two unknown. It is current through 5 September 2026 at 15:43 BST.
The historical evidence lineage contains eight current records and eight
superseded records. Obsolete machine-evidence replacement tasks have zero open
records; the eight older tasks are cancelled with audit history retained.

A new non-interactive Codex process then read that newest generation through
the MCP and exited successfully with:

`FRESH_GITHUB_MCP_OK total=15 pass=8 fail=5 unknown=2`

All seven read-only tools are approved for non-interactive local use. The
write-capable digest tool remains disabled.

## Final verification gate

- Application: 240 test files, 2,071 tests passed, 3 intentionally skipped.
- Database: 90 files, 1,888 tests passed.
- Live integrations: 3 files, 6 tests passed against local Supabase.
- Lint, TypeScript checks, and the production build passed.
- Immutable CEO fixture verification passed with 30 expected records, zero
  audit-event delta, and unchanged protected-data hashes.
- The independent supervisor returned **APPROVED** with no blocking issue.

The optional local Supabase analytics container was removed from the demo
runtime after a crash loop caused Auth and database requests to time out. It is
not used by the application, GitHub scanner, or MCP. With analytics excluded,
the health check returned HTTP 200 in 20 ms and the previously timing-out live
integration suites passed in 3.10 seconds. The README now documents the stable
local startup command.

The fresh full-page monitoring screenshot is
[`phase3-monitoring-live-2026-09-04.png`](./phase3-monitoring-live-2026-09-04.png).
The fresh full-page readiness dashboard screenshot is
[`phase3-dashboard-live-2026-09-04.png`](./phase3-dashboard-live-2026-09-04.png).
