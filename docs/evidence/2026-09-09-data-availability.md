# Dashboard and audit availability evidence

Starting source: `63dd7ab611cc81defa88b72958403c5f0b784585`. Specification: [dashboard and audit data availability](../superpowers/specs/2026-09-09-unavailable-dashboard-data.md). The [release checklist](../release-checklist.md) remains the overall status source.

## Before-change reproduction

On 9 September 2026, an authenticated fictional coordinator opened a copy of the previously verified production package using the preserved isolated local database. A private Node preload returned HTTP503 only for GET requests to the selected `risks` or `audit_findings` REST endpoint at `127.0.0.1:55321`. All other requests continued normally. The fault ran only in the temporary preview at3301; the ordinary background app at3300 was unaffected. No database permissions, records or application code were modified to inject failures.

At both1440×1000 and393×851, the risk failure visibly produced “Residual exposure — no open risks yet” despite a saved fictional risk. The findings failure produced OPEN FINDINGS0 and NON-CONFORMITIES0 despite a saved major non-conformity. A preflight warning did not qualify those metric cards. Removing the fault and reloading restored the existing facts. The demonstration added one clearly fictional audit/finding to the fictional workspace and preserved existing records.

Private reproducible harness: `artifacts/data-availability/demo.mjs before <previous-local-runtime>`, run through the local resource guard; captured verdicts and raw logs stay ignored. The after run uses the same external boundary, fixture and viewport sizes against the candidate package. This is controlled local failure evidence, not proof of provider or hosted recovery.

## Retry defect reproduced during acceptance

The old package also failed the recovery assertion when a temporary SoA read failure was removed and the operator pressed Try again: the error remained. A focused error-component test separately failed because the Next.js retry callback was never invoked. The installed Next16.3 documentation distinguishes reset (re-render existing children) from retry (fetch fresh content). The fix uses retry; the same original SoA-failure recovery check now passes against the candidate production package on desktop and mobile.

## Implementation and verification

Implemented: required dashboard query failures no longer produce an apparently valid summary. Audit findings metrics display Unavailable beside their explanation while the known audit count and list remain usable. The authenticated page error action now fetches fresh server content.

Fresh local checks against the candidate source:

- Focused server-page/error-boundary regressions:34 passed, including red-before-green query failure, successful empty, populated and retry behavior.
- Full unit suite:305 files passed;2,622 tests passed,3 existing skips.
- Typecheck, ESLint and the production build passed under the resource guard, run sequentially.
- Actual production Chromium: desktop1440×1000 and mobile393×851 each demonstrated risk failure→explicit error→keyboard Try again→recovered dashboard, and findings failure→unavailable metrics with retained audit→reload→restored finding count.
- Targeted axe WCAG2A/AA checks found no serious/critical violations in those two changed states at either size; no document-wide horizontal overflow. This does not establish full accessibility conformance.
- [Independent Standards and Specification reviews](2026-09-09-data-availability-review.md): no material findings.

Database schema, role permissions and query tenant filters are unchanged; database permission suites were not rerun for this read/error-presentation-only change. The browser demonstration exercised authenticated reads from the real preserved isolated database. Local fault injection is not a real provider outage or hosted acceptance.

## Visible evidence

| Scenario | Before | After |
|---|---|---|
| Audit findings read failure, mobile | [False zero counts](data-availability-2026-09-09/before-mobile-audits.png) | [Unavailable counts](data-availability-2026-09-09/after-mobile-audits.png) |
| Dashboard risk read failure, desktop | [False no-risk message](data-availability-2026-09-09/before-desktop-dashboard.png) | [Explicit error and retry](data-availability-2026-09-09/after-desktop-dashboard.png) |

Additional evidence: [mobile error and keyboard focus](data-availability-2026-09-09/after-mobile-dashboard.png), [desktop audit failure](data-availability-2026-09-09/after-desktop-audits.png), [recovered audit findings](data-availability-2026-09-09/after-desktop-recovered.png). All screenshots contain fictional local demonstration data.

## Limits and remaining work

These changes address the recorded failure paths, not every potential failure in the application. Live-provider recovery, hosted release, stakeholder acceptance and measured manual-work savings remain open. Separate asset import/export and collector observation-model findings remain in the programme assessment.
