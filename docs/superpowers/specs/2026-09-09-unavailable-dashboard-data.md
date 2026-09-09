# Dashboard and audit data availability

Starting point: `63dd7ab`. Part of the [ongoing lifecycle programme](../../plans/operating-lifecycle-quality/assessment.md). Overall status remains in the release checklist.

## Problem Statement

A coordinator opening the dashboard can see “no open risks” or an empty work queue when a required database query actually failed. On the audit register, a failed findings query produces zero open findings and non-conformities beside an unrelated preflight warning. Both can mislead decisions about ongoing work.

## Solution

Required dashboard read failures use the existing page error and retry experience. Audit findings failures explicitly mark the dependent metrics unavailable while retaining the successfully loaded audit list. A successful empty result remains a valid zero.

## User Stories

1. As a coordinator, I want failed risk reads to remain unknown rather than appear as no exposure.
2. As a coordinator, I want failed work and evidence reads to stop an incomplete dashboard being presented as complete.
3. As an operator, I want failed setup counts or risk configuration reads distinguished from an empty workspace or an absent optional configuration.
4. As an audit reviewer, I want unavailable findings metrics identified next to those metrics.
5. As an audit reviewer, I want my successfully loaded audit list and its open-audit count to remain usable during a findings failure.
6. As an operator, I want a successful empty workspace to retain its useful first-use guidance and zero counts.
7. As an operator, I want recovery after the source becomes available, without changing stored records.
8. As a Member, I want my existing authorised overview and access boundaries preserved.

## Implementation Decisions

Check the existing server-page database results before deriving dashboard values. Reuse the authenticated app error boundary; do not expose raw database details. A local browser reproduction showed its reset action did not fetch fresh server content after recovery. Use the installed Next.js retry contract to re-fetch and render the recovered page. Audit metric availability follows the findings result, independently of audit-list availability. Existing preflight error handling remains. Keep tenant filters, permissions, calculations and source limits unchanged. No schema or stored-data change is needed.

## Testing Decisions

Use the existing server-page rendering tests and actual browser journeys, as authorised by the standing project conventions. Reproduce each defect before its fix. Test visible outcomes for failed data/count/config reads, successful empty results and normal populated results. Demonstrate controlled local server-side read failure and recovery in desktop/mobile browsers with fictional data; any fault injection remains outside application source. The ordinary preview must stay usable. Run appropriate unit, type, lint and build checks sequentially under the Mac resource guard. Independent standards and specification reviews use the recorded starting commit.

## Out of Scope

New roles, permission changes, database migrations, dashboard redesign, asset import/export changes, collector observation semantics, hosted deployment and live-provider acceptance.

## Further Notes

Source inspection establishes the two scenarios; regression failures and browser evidence establish reproduction. Local proof does not establish hosted or stakeholder acceptance. The bounded slices are tickets06 and07 in the existing programme, with neither blocking the other.
