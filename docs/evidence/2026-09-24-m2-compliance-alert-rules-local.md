# Milestone 2 compliance-change alert rules: local source evidence

This describes source on `codex/m2-monitoring-design`, not Slack delivery or an AWS dev release.

## Changed

- A pure builder classifies new GitHub check failures, stale results, sustained Unknown results after 36 hours, and verified recovery. It suppresses unchanged Pass results and repeated active incidents. A later same-day failure has a distinct incident identity.
- Messages use fixed bounded copy, a trusted site origin, and an exact Finding or Evidence link. Provider text is not interpolated. An Unknown without an addressable result is blocked, not downgraded to a generic Monitoring link. The private-channel destination is a declared requirement, not proof that a real Slack destination is private.
- Independent Astra review found that an expired Pass could be skipped, an older Pass could be called recovery, and the exact expiry instant disagreed with Monitoring. Regression tests failed first and passed after the fixes.

## Fresh verification

- Focused alert-rule suite: **9 passed**. The initial seven tests passed before independent review; two new regression tests exposed the review findings.
- Integrated application suite: **357 files, 3,233 passed, 3 intentionally skipped**. TypeScript, full lint, guarded production build and `git diff --check` passed after integration.
- The focused test ran with the documented 7.5 GiB guard start override because the Mac briefly had 7.9 GiB free; no database or personal files were deleted. The full application suite, lint and build later ran under the guard's normal limits.
- No database migration was introduced, so the older clean-install and upgrade evidence remains historical and was not rerun for this code-only change.

## What is not proven

The builder is not called by collection or materialisation. There is no persisted incident state or first-actionable-Unknown clock, exact Unknown result page, additive alert queue contract for multiple incidents per day, private-channel destination proof, in-app notice, Slack send, or live scheduled event. The local preview at `http://127.0.0.1:3500/app/monitoring` still runs the earlier Mapping Review build with fictional data; it does not demonstrate this builder. AWS dev is unchanged. Complete those integration and acceptance gates before deployment.
