# Risk workspace refinement

Starting point: `75b6d3964b23aab077bef30823f13f1ce7fd82e9` on 10 September 2026.

## Problem Statement

The risk workspace contains the necessary records, but its register, detail view and forms do not yet work as one clear operating journey. On mobile the register hides the decision-making fields behind a wide table. The detail page separates assets from the related work and evidence. Forms are long and lose entered values when validation or saving fails. Several database read failures can look like an empty register, default risk thresholds or a missing record, which can give coordinators and leadership a false conclusion.

## Solution

Make the existing Risk register → risk detail → create/edit journey coherent and truthful. The register will put current exposure and attention first, present readable desktop and mobile records, and keep configuration secondary. The detail view will connect ownership, exposure, treatment plans, tasks, assets and linked evidence. Create and edit will share a structured, recoverable form with stale-edit protection. Existing scoring, statuses, treatment meanings and role permissions remain unchanged.

## User Stories

1. As a compliance coordinator, I want to scan open exposure, overdue reviews and missing owners, so that I know where to act first.
2. As a reviewer, I want the heatmap and rows to use the same saved thresholds and scores, so that the visual summary is trustworthy.
3. As a mobile user, I want each risk to remain readable without horizontal page scrolling, so that I can understand and open it on a phone.
4. As a reviewer, I want a risk detail page to show its owner, review date, inherent and residual exposure together, so that I can understand the decision quickly.
5. As a reviewer, I want linked assets, tasks and evidence to remain connected to their source records, so that I can inspect the support for a conclusion.
6. As a coordinator, I want treatment-plan progress to distinguish completed, cancelled and outstanding work, so that cancelled work is never presented as complete.
7. As an operator, I want a workspace-wide suggested treatment-plan reference, so that the default does not collide with another risk's plan.
8. As an operator, I want create and edit forms grouped by context, scoring and treatment, so that related decisions are made together.
9. As an operator, I want field errors to preserve my draft, so that a correction does not require re-entering the risk.
10. As an operator, I want a stale edit rejected with my draft still visible, so that I do not silently overwrite a newer risk decision.
11. As a Member, I want the same connected risk context without management controls, so that read access does not imply decision authority.
12. As any authorised user, I want load failures identified as unavailable, so that missing data is not confused with no risk or a low score.

## Implementation Decisions

- Preserve the existing 1–5 likelihood and impact scales, matrix thresholds, appetite rule, treatment values and risk statuses.
- Use the existing route and server-action seams. Keep database access in the server pages/actions and risk calculations in the risk domain modules.
- Treat `open`, `treating` and `accepted` risks as non-closed exposure. Closing a risk remains an operator action; treatment-plan completion does not close it automatically.
- `accept` treatment and `accepted` status remain recorded operator decisions. This batch does not introduce a separate approval workflow or imply verified remediation.
- Label missing owner and review date explicitly. Free-text evidence references remain distinct from linked evidence records and their freshness state.
- Use a compact graphical summary plus readable records. The mobile presentation may change from a table to cards while preserving the same information and links.
- Keep risk-band configuration available to authorised operators in a secondary disclosure below the operational summary.
- Check all material register and detail reads. A failed primary read must not become an empty state or 404; a failed threshold read must not silently substitute default bands for saved workspace bands.
- Protect full-form edits with the risk's recorded `updated_at`. Every risk status writer must advance the same version so competing changes are visible to the guard.
- Preserve a selected category or owner in edit choices even when ordinary option loading would omit it.
- Choose suggested `RTP-NNN` references from the whole workspace uniqueness scope. This convenience does not replace database uniqueness enforcement.

## Testing Decisions

- Test treatment progress and reference suggestion through the pure risk-domain interfaces.
- Test recoverable validation, write failure and stale-edit behaviour through the state-returning risk form actions.
- Extend risk page/action tests for permissions, query-failure truthfulness, selected-option preservation, connected records and version changes.
- Use the existing production-browser maintenance seam for the connected owner journey, desktop/mobile presentation, keyboard labels and persistence.
- Behaviour tests assert user-visible facts and saved outcomes rather than CSS implementation details.

## Out of Scope

- A new risk-acceptance approval or decision-history data model.
- A new scoring model, historical trend series or provider verification claim.
- Removing the existing 500-row register display limit. The interface must disclose a capped displayed population rather than claim it is complete.
- Hosted deployment, live-provider verification and intended-user acceptance.

## Further Notes

The approved product-wide mockups guide hierarchy, typography, spacing and responsive behaviour. Fictional counts and unfamiliar actions in those images are not requirements. The release checklist remains the only overall status source.
