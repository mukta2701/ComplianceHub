# AWS dev visual cleanup: dashboard and Connections

25 September 2026. This records a bounded AWS **dev** UI release, not production or Milestone 1 acceptance.

## Change

- Removed the “Reduce admin later” card and its misplaced integrations link from the dashboard.
- Hid the unfinished MCP/connected-assistants panel from Connections. Its underlying OAuth and MCP implementation was left untouched for a later milestone.
- Kept GitHub repository monitoring, the configured private-channel Slack destination, and optional GitHub Issues/Jira cards.
- No database migration, GitHub App access change, Slack message, or live provider rehearsal was part of this release.

## Verification

- Paid OpenCode Go Muse implemented the four-file UI/test change. The coordinator inspected the exact diff and reran lint, typecheck, all local unit tests (3,466 passed, 3 skipped), and a production build. An isolated fictional Owner preview at `http://127.0.0.1:3800` showed both cleaned pages; GitHub access details and the Slack setup panel still opened. The local preview's application source is `76128c8` and remains running.
- The first [CI run](https://github.com/mukta2701/ComplianceHub/actions/runs/36120275299) caught one stale browser-test assertion that still expected the intentionally removed card. Muse corrected only that assertion. A second [CI run](https://github.com/mukta2701/ComplianceHub/actions/runs/36121621384) passed application, database, container, secrets and changes jobs for commit `4b109e8`, including the browser suite.
- A targeted local Playwright rerun was not started: the Mac resource guard found 5.8 GiB free, below its 6.5 GiB start threshold. The successful CI browser suite is the fresh end-to-end evidence for the corrected assertion; no local browser rerun is claimed.
- [AWS dev deployment run 36122683324](https://github.com/mukta2701/ComplianceHub/actions/runs/36122683324) succeeded for commit `4b109e8` with optional live GitHub reconciliation skipped. Fresh public `/api/health/live` returned that full release SHA and `/api/health` returned the same SHA with `db: ok`.
- In an existing signed-in hosted Owner session, `/app` retained “Build your programme” and no longer rendered “Reduce admin later.” `/app/integrations` rendered GitHub monitoring, configured Slack, GitHub Issues and Jira, without the MCP/connected-assistants panel or its earlier read-error text. These are read-only page checks, not proof of fresh GitHub collection or Slack delivery.

## Still open

Milestone 1 still needs the controlled new-incident/recovery Slack proof, the live Admin/Member role rehearsal, a default-branch unattended schedule proof, and Owner acceptance. This release does not close those items.
