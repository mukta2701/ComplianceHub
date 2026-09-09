# Programme dashboard and shared shell

Starting commit: `f6ac518`. The owner approved the [product-wide mockup direction](../../design/2026-09-09-product-mockups/README.md) and the first dashboard/navigation implementation increment.

## Outcome

An operator can scan the programme's attention counts, current control position, priority actions, risk distribution, evidence freshness and upcoming dated work in one calm, graphical workspace. Navigation retains the same routes and role-specific access while adopting the approved lighter visual language.

## Acceptance

1. Four linked summary cards show exact workspace counts: non-closed risks; open/in-progress tasks due before today (UTC); policies in review; evidence recorded as expiring. Counts are independent of capped chart/action queries. A missing count is unavailable, not zero; query errors preserve the existing recoverable dashboard failure behaviour.
2. A broad current-position card shows the existing weighted maturity calculation and labelled horizontal status bars. Preserve denominator and exclusion explanations. Do not invent historical trends, certification or reviewed coverage from current statuses.
3. A compact queue keeps the existing priority rules and shows the top three actionable source links. Full registers remain reachable. Evidence collection and replacement semantics remain unchanged.
4. Evidence and risk charts retain labelled counts and source links. State when a chart is a subset. Identify unscored risks; do not describe them as no open risks. Heatmap links have meaningful accessible names. Use residual scores where recorded and otherwise explain inherent-score fallback.
5. Show up to four upcoming tasks within the existing earliest-25 dated-open-task shortlist, with explicit scope, full dates and a route to all tasks. Preserve activity, saved-baseline entry, setup guidance and optional integration entry.
6. Apply the approved light canvas, navy text, blue actions and restrained status graphics. Retain member-specific overview and navigation. Breadcrumbs identify the actual workspace and page. Preserve drawer keyboard behaviour, focus isolation, skip link and responsive navigation.
7. Demonstrate populated and empty operator pages, unchanged member access, valid metric destinations, disclosure behaviour and no document overflow at representative desktop/tablet/mobile widths. Automated accessibility findings supplement visual and keyboard review.

## Verification

Reuse established rendered AppHome/AppShell tests and fictional Playwright browser seams. No new schema, policy or provider operation is needed. Run meaningful count/error/unscored tests red then green, affected role/render tests, full unit suite, typecheck, lint, production build and local browser checks sequentially under the resource guard. Record independent standards and specification reviews against the starting commit.

## Boundaries

This increment implements the dashboard and shared shell. Remaining page-specific mockups, actual historical series, consolidated contribution-review metrics, global search, provider acceptance and hosted/human acceptance remain separate work. This specification does not change permissions or data definitions. The release checklist remains the overall status source.
