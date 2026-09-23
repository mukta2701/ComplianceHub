# Milestone 2 Monitoring currentness — local candidate

This is a feature-branch increment, not an AWS dev release or accepted Milestone 2 journey. The local app preview at port 3100 was not rebuilt from this branch.

## What changed

- The Monitoring headline and repository cards count a result as current only when its mapping is active and its observation is still fresh. Historical and stale results remain inspectable but are excluded from current pass/fail counts.
- A repository with only some approved current checks is labelled as a partial review, not a processing failure. A newer pending collection does not downgrade 15 still-current results; its processing state appears separately. Collection and job failures retain priority.
- An additive database history records mapping-pack selections going forward. A Member-safe status reader evaluates the exact entry receipt and approval at a snapshot; control-room and MCP v1 output use that status. Older ambiguous history is not reconstructed.

## Fresh verification and limits

- Focused UI/domain Vitest: 35/35 passed on the feature branch after the pending-collection regression was added. The affected Monitoring page tests passed 15/15 after the summary was separated from the action-heavy control-room component.
- A fresh source-only disposable Supabase project (`compliancehub-m2-sourceonly`, database port 56432) replayed the branch migrations through `20260923174305`. Currentness pgTAP 117 passed 17/17, including pack switch and reject–reapprove history. Other focused suites passed: 072 78/78, 078 17/17, 079 62/62, 115 45/45 and 116 4/4. The preserved local database and the earlier experimental database were not reset.
- Fresh final full application suite: 3,187 passed, 3 intentional skips across 353 files. Full ESLint and TypeScript typecheck passed. A normal Turbopack production build passed after installing dependencies inside the isolated worktree. Its earlier failure was caused by a `node_modules` symlink pointing outside Turbopack's filesystem root; a diagnostic Webpack attempt was not used as release evidence. These are source/build checks, not a rendered browser journey.
- The test currently proves that a legacy-approved workspace can create a receipt without an explicit pack selection; it does not yet prove the resulting official record's status end to end.
- The digest suite 073 has 12 failures among 62 assertions on the fresh source-only database. Its transaction-time snapshot predates selection-history events written later in the test transaction; its nullable approval lineage also drops new entry-receipt events. MCP v2 still uses whole-pack-only classification for new entry receipts. These need a separate additive migration before this branch is deployable. The passing 079 suite does not prove MCP v2 currentness for entry receipts. Job wake/finalisation and the old service-callable result route remain separate release blockers.

No preserved database, GitHub App, local preview or AWS dev state was changed by this increment.
