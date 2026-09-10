# Policy workspace refinement evidence — 10 September 2026

## What changed for people using ComplianceHub

Before this increment, the Policy area spread lifecycle information across dense screens, could undercount records beyond one database page, and let technical update conflicts surface as confusing failures. Ownership was easy to lose while editing, draft policies showed acceptance context too prominently, and readers could be offered Evidence links they were not allowed to open.

The Policy library now gives coordinators a responsive, scannable view of ownership, status, content version and review timing. Counts cover the stated workspace population, while displayed lists identify their limits. Policy detail leads with the document, keeps approval and personal acceptance separate, shows the accountable owner and review cycle, and exposes source Evidence links only to roles that can open them. Members still see the evidence titles needed to understand a conclusion.

Create and Edit use the same structured fields and preserve entered text when validation or a write fails. Choosing a template asks before replacing unfinished work. Approval, status and acceptance actions detect when the displayed policy is no longer current and leave the person on the document with clear recovery guidance.

## Backend and trust behaviour

- A technical edit revision now changes on every saved policy update, independently of the reader-facing content version.
- Content edits advance the content version once; metadata edits do not force people to accept the same content again.
- Approval and status decisions compare the version and revision the reviewer actually saw. A stale decision changes no row.
- The acceptance database function locks the policy, derives identity and workspace on the server, and accepts only the exact approved content version shown to the reader.
- A stale or withdrawn-policy acceptance creates no acceptance record.
- Policy-review tasks show their actual due date separately from their recurrence cycle.
- Existing Owner/Admin approval authority and ordinary Member restrictions remain unchanged.

## Verification performed

All checks below are fresh on 10 September 2026 unless described otherwise.

- Focused final policy unit run: 13 files and 75 tests passed.
- Full unit run: 323 files passed, 2,770 tests passed and 3 were skipped by their existing conditions.
- Lint and TypeScript checks passed.
- A production build passed and was packaged independently from the worktree.
- Integration run: 5 files and 8 tests passed against the isolated local team environment.
- Database run: 101 files and 2,238 pgTAP checks passed. The policy-specific database suites also passed against the team database after its additive migration.
- Final production-browser run against the permanent `http://127.0.0.1:3300` process: 4 of 4 checks passed in Desktop Chrome and a 393 px mobile viewport. The journey created and edited a fictional policy, preserved and changed its owner, approved it, accepted it as a Member, reloaded the saved acceptance, and found no serious or critical automated accessibility violations.
- The same browser run changed the policy behind two open pages. Stale approval and stale acceptance were rejected with inline recovery guidance; the stale acceptance count remained zero.
- Independent specification and standards reviewers reported no material remaining findings. Independent visual review covered the library, detail and new-policy form at desktop, 883 px tablet and 393 px mobile widths and found no clipping or material layout problem.

The first browser command omitted the isolated test credentials, so Playwright correctly skipped four tests. It was rerun with the supported `.env.local` inputs; the 4-of-4 result above is the evidence used for acceptance. During an earlier database-suite attempt, a connection mismatch interrupted one deterministic test fixture. The repository's exact cleanup routine removed only the `71000000-...` synthetic organisations and users, and a follow-up query confirmed zero remain.

## Visual evidence

- [Desktop draft policy and owner guidance](policy-workspace-2026-09-10/desktop-draft-policy.png)
- [Desktop employee acceptance](policy-workspace-2026-09-10/desktop-employee-acceptance.png)
- [Mobile draft policy and owner guidance](policy-workspace-2026-09-10/mobile-draft-policy.png)
- [Mobile employee acceptance](policy-workspace-2026-09-10/mobile-employee-acceptance.png)

## Release identity and limits

Application source `dd846651cf431fa6da867f01e3a30ca22c92a6ef` is committed and pushed to `origin/codex/team-baseline`. Its immutable local package is running on port 3300 with `db: ok` and the matching release SHA. The migration is applied to the isolated local team database; existing fictional policy `POL-LAB-01` was restored to its original draft state after visual inspection.

This establishes implemented code, automated checks and fictional local behaviour. It does not establish a hosted release, live-provider behaviour, screen-reader acceptance or stakeholder acceptance. Rich-text editing, revision archives, e-signatures, new approval roles, policy-control mappings, private feedback notifications and automatic review renewal remain deferred product work.
