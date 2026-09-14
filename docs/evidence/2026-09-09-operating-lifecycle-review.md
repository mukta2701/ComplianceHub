# Independent operating-lifecycle reviews

Starting commit: `4b413a048a9d77a264b07a4abc585b3cddc8742a`. Reviewed candidate: committed planning plus staged/working implementation against that point (`git diff 4b413a0 --`), not just HEAD. Two independent read-only agents reviewed standards and specification in parallel. The specification is `docs/superpowers/specs/2026-09-09-operating-lifecycle-quality.md`; the integration-acceptance ticket remains the final gate.

## Standards

1. **Verification regression:** the new collection-health integration test accepted only local port 55321, but canonical CI uses 54321. This would fail CI during module loading. Fixed to accept the two supported exact loopback origins while rejecting hosted targets. Static finding; local integration execution is separate evidence.
2. **Possible Duplicated Code, nonblocking judgment:** health-attempt orchestration is repeated in manual baseline, proposal recollection and collection-run paths. A small shared helper could reduce coordinated future edits. Deferred: their evidence persistence and result handling differ, and this batch has behavioral coverage across those entry points. No additional abstraction is needed to correct the current failures.
3. **Possible Primitive Obsession, judgment:** recovery selected a successful-write/failed-notification outcome using an exact error-message string. Fixed for that outcome with a returned `notificationFailed` flag and confirmed saved version. Existing access/stale-error messages retain their established handling; a wholesale action-result redesign is outside this increment.

Standards: three findings, including one blocking verification issue; fixed or disposition recorded individually.

## Spec

1. **Committed policy revision lost on notification failure.** Requirement: advance a draft only from the version returned by its own successful database update. The old wrapper returned a warning without the committed version, blocking subsequent edits as stale. Fixed: the update returns its version with a notification-failure flag, including notification transport errors; the wrapper retains both warning and version, and the form advances its own revision.
2. **Editing while saving hid delayed failures.** Requirements: recoverable feedback and visible uncertainty after lost responses. The old form hid errors whenever typing set its edited flag. Fixed: errors remain visible; only stale success feedback is suppressed when the draft changes.

Spec: two implementation findings. Both reproduced in focused tests before correction (three failing assertions, fourteen passing); after correction all seventeen action/form tests pass. Independent source re-review reports both resolved and no remaining material policy issue. The complete suite, browser demonstration and resource-guard review are recorded separately; source review alone is not a runtime claim.

## Resource-guard and visual follow-up

Independent standards review found no material guard defect after the Mac-specific exit-race correction. macOS can briefly return EPERM when the last process-group member disappears; the guard reconciles that error only when a fresh successful process inventory confirms no live group members. A genuine permission denial remains an error. An actual build trace then exposed a briefly exiting live worker; a bounded 200 ms inventory recheck now waits for its disappearance and still rejects persistent live-group denial. Eight focused CLI tests pass, including safe process-group shutdown and injected OS-boundary regression; project TypeScript and scoped lint pass. Twelve real short-lived descendant commands preserved their expected exit code. The initial failing build/typecheck and guard-cleanup attempts remain in private evidence rather than being reported as passes.

Independent desktop visual review inspected the actual before/after policy and risk screenshots. It found no clipping/overlap in the added owner controls or linked assets. It did find a completed employee acceptance still requesting acceptance below; this was reproduced with one failing assertion, corrected to show the instruction only when needed, and all nine policy-page tests passed. Mobile and final-runtime readback are recorded in the release evidence.
