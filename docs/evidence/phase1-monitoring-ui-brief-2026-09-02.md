# Phase 1 Monitoring UI completion brief

Phase 2 is frozen. This task completes the visible Phase 1 GitHub monitoring experience without changing collection, materialisation, database, MCP, Slack, or GitHub permission behavior.

## Required user experience

The default Monitoring page must answer, in this order:

1. Is monitoring connected and trustworthy?
2. Which repositories are monitored, when were they last checked, and what needs attention?
3. Which active findings require action?
4. How do technical checks become reviewed ISO evidence or findings?

The first three answers are visible immediately. Governance, mapping identity, approval history, raw check identifiers, and recovery controls live under a closed-by-default `Technical review and recovery` disclosure. The inner 15-check mapping catalogue is also closed by default.

## Truth and language requirements

- Count an active GitHub App installation as a monitored system. Never show `0 systems monitored` while one is active.
- Zero persisted findings alone must not imply that monitoring passed. Use neutral wording such as `No recorded active findings` unless current completed coverage proves a clean result.
- Use `GitHub monitoring`, `Check GitHub now`, `Checking GitHub…`, `Last checked`, `Up to date`, `Needs a new check`, `Ready for first check`, `Some checks could not be completed`, `Check failed`, and `GitHub rate limit reached` as appropriate.
- Do not expose `official collection`, `control room`, `shadow`, `materialisation`, `mapping pack`, checksum, UUIDs, or raw check IDs on the default visible surface.
- Explain the security boundary in plain language: GitHub access reads repository settings and metadata and never changes GitHub; a check can update ComplianceHub's own evidence and findings.
- Do not claim certification or that GitHub alone proves ISO compliance.

## States and actions

- Disconnected: say GitHub is not connected and give Owner/Admin a link to `/app/integrations`; Members get read-only guidance.
- Connected but no selected repository: explain and link eligible operators to connection settings.
- Never checked: show `Ready for first check`.
- Running: show `Checking now`.
- Succeeded/current: show `Up to date` and the localized last-check time.
- Partial: show `Some checks could not be completed` and the issue count.
- Failed: show `Check failed`.
- Rate limited: show `GitHub rate limit reached`.
- Stale (36 hours or more): show `Needs a new check` and the last-check time.
- Owner recheck button is `Check GitHub now`; while pending it is disabled, `aria-busy=true`, and says `Checking GitHub…`. Success refreshes; rejection shows a safe nearby error and does not refresh.
- Admin and Member remain read-only; existing mapping/recovery authorization remains unchanged.

## Layout and accessibility

- Overall summary, GitHub repository status/action, active findings, then collapsed technical review.
- The generic connected-systems area must not contradict the GitHub connection and should not duplicate the main GitHub information.
- No document-level horizontal overflow at desktop, tablet, or 390px phone widths.
- At phone width, banners/actions/cards become one column, buttons are full-width touch targets, and long repository names/timestamps wrap.
- Preserve keyboard focus, semantic headings, status live regions, and accessible action names.
- Add route-local loading and error surfaces with safe copy and a retry button.

## Required TDD evidence

Write tests first and run them to an expected failure before editing production code. Cover:

- truthful active-GitHub system count and neutral zero-findings wording;
- hierarchy and closed technical disclosure;
- disconnected, no-repository, never-run, running, current, issue, partial, failed, rate-limited, and stale repository states;
- human-readable last-checked time;
- Owner pending/success/failure behavior and Admin/Member read-only behavior;
- loading and error surfaces;
- responsive whole-page overflow and accessibility in the existing Playwright flow.

After implementation, run focused tests, typecheck, focused lint, full test suite, production build, and the relevant desktop/mobile browser checks. Preserve every unrelated dirty file and do not commit, merge, push, publish, post to Slack, or trigger a GitHub recheck during implementation.
