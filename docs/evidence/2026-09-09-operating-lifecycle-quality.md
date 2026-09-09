# Operating-lifecycle quality — local release evidence

## What improves for people using ComplianceHub

- **Accountable policies:** operators can see, retain, change or clear the owner. The edit form explains pending, saved and failed/uncertain saves and keeps entered text. Only approved policies invite personal acceptance; completed acceptance no longer asks employees to repeat it. A confirmed content revision is retained even when its notification fails.
- **Ongoing reviews:** later policy-review cycles can create their own task without losing completed history; repeating a sweep does not duplicate the same cycle. Reopening and completing an occurrence that already recorded a successor does not create another successor. These database guarantees preserve existing operator/Member authority.
- **Connected context:** risk reviewers can open linked assets, including by keyboard at phone width. Missing linked data has a distinct recovery state. Control-register guidance explains that an assessment starts human review rather than silently deciding applicability.
- **Truthful collection health:** source/provider/persistence failures are counted once per attempted source, preserve prior successful collection dates and mark the valid linked connection as needing attention. Only a complete later success clears that failure. Paused, revoked and other-workspace connections are not revived. Saved evidence and human decisions remain distinct from collection health.
- **Usable local preview:** production mode runs independently in the background on port 3300 against isolated local data. Regenerable cache cleanup and bounded development commands reduce the pressure implicated in the Mac freeze. [Recovery evidence](2026-09-09-mac-recovery.md).

## Architecture and scope

This increment retains the existing Next.js/Supabase modular monolith. The form owns its unsaved draft and original revision; the server action returns the database-confirmed outcome; existing database rules enforce approval/acceptance and role boundaries. Recurring successor creation and its generation marker share one locked transaction. A scheduled policy-review cycle has a stable date distinct from an editable deadline. Collection health is written after the entire attempt and conditionally matches tenant, provider and connection availability. No new hosted service or framework was introduced.

The full product direction remains the connected company programme in the [assessment](../plans/operating-lifecycle-quality/assessment.md), not a single onboarding scenario. [Independent reviews and dispositions](2026-09-09-operating-lifecycle-review.md) cover the candidate from `4b413a0`.

## Verification record

All execution below uses fictional local data. Raw outputs, test identities and runtime artifacts remain ignored/private under `artifacts/operating-lifecycle/`.

- Full unit suite: **304 files; 2,597 passed, three skipped** using one worker under the resource guard. Subsequent review corrections have focused regression coverage: **17 policy action/form checks**, **nine policy-page checks**, and **eight guard CLI checks**. A final combined run of those four files passed all **34 checks** after the last review corrections. Red-before-green evidence is retained for owner preservation, recurring cycles, collection failure, stale/uncertain policy saves and the acceptance-copy correction.
- Full local database suite: **99 files; 2,167 assertions passed** against the isolated stack using its local runtime configuration. The explicit DB-URL CLI mode first failed to connect; the supported local-stack invocation passed. No production database or destructive upgrade/reset script was used.
- Real local collection-health integration: **one scenario passed**, reading saved health through the authenticated interface and checking tenant/provider/pause/revocation boundaries. No live provider was contacted.
- TypeScript and lint pass. The final uninstrumented production build, including typechecking, completes successfully through the corrected resource guard (exit 0). The earlier build-output success with guard-cleanup failure is retained as an unsuccessful wrapper run, not substituted for this fresh result.
- Broad production browser run: **54 of 60 passed**. Six failures were the same two infrastructure/selector issues on desktop and mobile: an obsolete “Accept as task” selector and a missing local Realtime service. The selector now uses the visible “Create task” action; Realtime is restored. Targeted reruns below close those failures without disguising the original failed run.

**64 distinct desktop/mobile browser checks have passing final outcomes across the broad run and targeted reruns**, verified by matching each named test; this is not a claim of one uninterrupted 64-test passing run. The final rebuilt policy/risk/Phase 1/contribution run passed **12/12** desktop/mobile checks, including keyboard asset navigation, accessible forms, retained owners, approved-only employee acceptance and concurrent assignment/submission behavior. The restored Realtime tracker scenarios passed on desktop and mobile. A further Member test exposed an older expectation that the Tasks register must redirect; the already-agreed contribution portal permits this register. The test now checks that read access while retaining creation/export denial; both corrected Member-portal checks now pass on desktop and mobile. All six initial browser failures have passing targeted reruns; no failing run was relabelled as a pass.

Independent visual review inspected the before image plus production desktop/mobile policy and linked-asset screenshots. The final accepted-state correction was re-inspected at both sizes with no remaining material visual findings.

| Evidence | Desktop | Phone |
|---|---|---|
| Policy owner and draft guidance | [View](operating-lifecycle-2026-09-09/policy-owner-chromium.png) | [View](operating-lifecycle-2026-09-09/policy-owner-mobile.png) |
| Completed employee acceptance | [View](operating-lifecycle-2026-09-09/employee-acceptance-chromium.png) | [View](operating-lifecycle-2026-09-09/employee-acceptance-mobile.png) |
| Risk and linked asset context | [View](operating-lifecycle-2026-09-09/risk-linked-assets-chromium.png) | [View](operating-lifecycle-2026-09-09/risk-linked-assets-mobile.png) |

[Policy before the change](operating-lifecycle-2026-09-09/policy-before.png). All shown accounts, organisations and records are fictional.

## Explicit limits and deferred work

Local automated proof does not establish provider verification, hosted deployment or human acceptance. Azure access/deployment approval and live-provider credentials/disposable targets remain external gates. The generic collector still needs an agreed model for repeated observations of the same resource; this increment improves failure truthfulness without silently changing evidence cardinality. Historical recurring tasks without reliable successor lineage remain unknown rather than guessed/backfilled. Long-term Mac stability needs observation; these mitigations do not diagnose every possible shutdown.
