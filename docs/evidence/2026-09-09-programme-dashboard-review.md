# Programme dashboard independent review

Starting point: `f6ac518`. Reviewed the working diff against that fixed point, including the new dashboard CSS module, before the final commit.

Specification: [programme dashboard and shell](../superpowers/specs/2026-09-09-programme-dashboard-design.md). Standards: AGENTS.md, CLAUDE.md, CONTEXT.md, local resource guidance and Matt Pocock's code-review smell baseline.

## Standards

Independent reviewer: dashboard_standards_review.

No documented-standard breaches identified. Workspace filters remain explicit, member routing is preserved, and labels distinguish recorded maturity/freshness from approval or verification. Missing attention counts remain visibly unavailable.

One low-priority possible Duplicated Code judgement call: list and count queries separately repeat lifecycle predicates. They currently agree. Centralise selection rules if those predicates evolve; a broader read-layer refactor is not justified for this presentation batch. Exact counts and limited row lists serve different purposes.

## Specification

Independent reviewer: dashboard_spec_review.

One minor source-link finding: Risk posture initially linked to the register only through populated heatmap cells, so empty or all-unscored states had no link within the chart. Resolved by adding an unconditional Open risk register footer link.

Otherwise, inspection found independent exact counts, unavailable-count handling, unchanged weighted maturity/exclusions, the top-three queue, explicit unscored/subset descriptions, scoped upcoming work, preserved member routing and drawer controls. No new permissions, invented historical series or synthetic mockup values were found.

## Review limits

Both reviewers rechecked the compact action disclosures and final risk source link. No material findings remained. Two cleanup observations (a stale colour comment and an unreachable repeated applicability comparison) were corrected. The separate dashboard_shell visual reviewer inspected the final populated 1440px and 393px production screenshots and found no material layout issue; screenshot inspection does not establish keyboard or permission behaviour.

These were independent static reviews. Browser appearance, accessibility, actual query results and production operation require the separate verification record. No material review finding remains open; the predicate duplication observation is a non-blocking maintenance consideration.
