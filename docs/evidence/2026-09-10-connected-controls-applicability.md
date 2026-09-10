# Connected assessment, controls and applicability evidence — 10 September 2026

## What changed for people using ComplianceHub

Before this increment, Gap assessment and Statement of Applicability looked like separate destinations. Completing an assessment returned the coordinator to a list, a working register used the name of its eventual formal output, and the control screen did not clearly show which assessment answers informed a decision. Repeated creation could produce competing drafts, two open tabs could overwrite one another, and some failed reads could look like an empty or ready workspace.

The Programme journey now has three explicit steps: **Assessment → Control review → Formal output**. Assessment pages show answered questions, missing supporting notes, source limitations and the correct next action. Starting a review twice safely reuses the active review. The editable screen is called a control review; **Statement of Applicability** is reserved for the immutable versioned output.

The review workspace makes each decision traceable. It shows the exact source assessment and revision, mapped answers, applicability, implementation status, accountable owner, rationale, evidence freshness, related work and formalisation blockers. The 93-control queue has labelled progress and attention counts, practical filters and a selected-control decision chain. Assessment answers remain guidance: the application never turns them into an applicability decision automatically.

Members can read the assessment and control context and follow every permitted source-assessment link, including from a selected control. Edit, import, export, finalise and new-version actions remain limited to authorised roles. Desktop, tablet and phone layouts expose the same decision information without horizontal page overflow.

## Backend and trust behaviour

- Review creation and successor creation are database transactions. They lock organisation-wide version allocation, recheck authority after waiting, reuse the correct active review and create one complete 93-control decision set.
- Ordinary authenticated users cannot bypass those commands with direct register or decision-table writes.
- Every editable control decision has a technical revision. Interactive saves and confirmed imports use the same guarded database command; one stale item rejects the complete batch without partial writes.
- A stale browser keeps the person's unsaved draft visible and requires an explicit refresh before another save.
- One central read model owns assessment provenance, mappings, controls, members, evidence, tasks, risks and finalisation readiness. A failed essential read produces **Could not verify** and blocks finalisation instead of becoming a reassuring zero.
- Finalisation requires the complete catalogue and follows the database contract: every control needs a rationale; applicable controls need an owner, a non-pending implementation state and linked evidence whose stored status is current or expiring; linked stored-expired evidence blocks finalisation. Evidence freshness remains distinct from implementation status.
- Finalised statements remain immutable and identify their source catalogue and assessment without presenting later assessment edits as archived facts.

## Verification performed

All results below are fresh on 10 September 2026 and use fictional data unless a limitation is stated.

- Final full unit run: 326 files passed; 2,901 tests passed and 3 were skipped by existing conditions.
- Full ESLint and TypeScript checks passed. The production build passed for source `055b5487979790e8aa7b768ad8ee06918777c766`.
- Full local database run: 101 files and 2,243 pgTAP assertions passed. The new creation, guarded-write and Member assessment-access suites passed separately as 103 assertions.
- Integration run: 5 files and 8 tests passed against the isolated local team database.
- A disposable upgrade rehearsal started from the schema immediately before this increment, applied the four new migrations in order, checked their ledger and permission boundaries, and passed the new pgTAP suite. The disposable project was then stopped and removed. The preserved team database was not reset.
- Final production-browser run against `http://127.0.0.1:3300`: 14 of 14 checks passed across Desktop Chrome and the mobile project. It covered assessment handoff, active-review reuse, mapped source context, protected saves, stale-tab recovery, Member read-only navigation through **Open source assessment**, responsive layouts, serious/critical automated accessibility checks and immutable Statement of Applicability creation.
- Manual browser inspection of the same production package confirmed the three-step landing page and the populated 93-control review at desktop width. Source, review state, blockers, progress, filters and the selected-control chain were visible and legible.
- Independent standards and specification review approved the final source with no material findings after Member route and source-link gaps were corrected.

A wider 112-test browser command was also attempted. It was stopped after 27 cases because older unrelated checks require a Slack test setting, assume the original local Supabase port, time out in a long Phase 1 scenario, or still assert headings/selectors that predate the completed dashboard, risk and audit redesigns. The affected controls journey above is green; the wider browser acceptance gate needs a separate maintenance batch before it can be treated as current whole-product proof.

## Visual evidence

- [Assessment handoff](connected-controls-applicability-2026-09-10/assessment-handoff-live-owner.png)
- [Controls & applicability landing](connected-controls-applicability-2026-09-10/controls-landing-live-owner.png)
- [Desktop control review](connected-controls-applicability-2026-09-10/control-review-1440-viewport.png)
- [Desktop control workspace](connected-controls-applicability-2026-09-10/control-review-1440-workspace.png)
- [Tablet control review](connected-controls-applicability-2026-09-10/control-review-1024-viewport.png)
- [Mobile control review](connected-controls-applicability-2026-09-10/control-review-390-viewport.png)
- [Mobile control workspace](connected-controls-applicability-2026-09-10/control-review-390-workspace.png)

## Release identity and limits

Application source `055b5487979790e8aa7b768ad8ee06918777c766` is committed and pushed to `origin/codex/team-baseline`. Its immutable local package is running on port 3300 against the preserved isolated team database. Both `/api/health` and `/api/health/live` report the matching release SHA; the database health check reports `db: ok`.

This establishes implemented code, passing automated checks and fictional local behaviour for the connected increment. It does not establish a hosted release, live-provider behaviour, screen-reader acceptance, certification or stakeholder acceptance. Automatic scope discovery, automated objective approval, baseline relocation, membership removal for people referenced by immutable historical records, and maintenance of the older whole-product browser suite remain separate work.
