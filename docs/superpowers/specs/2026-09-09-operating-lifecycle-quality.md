# Ongoing operating lifecycle quality programme

Starting commit: `4b413a048a9d77a264b07a4abc585b3cddc8742a`.

## Problem Statement
ComplianceHub already covers a broad security programme, but routine maintenance can lose accountability, duplicate future work, and obscure whether evidence really changed. A successful first baseline is only one stage of ongoing operation.

## Solution
Repair established workflows in complete, independently demonstrable increments. Preserve the existing visual system and make ownership, next actions, source dates and incomplete states explicit. Continue using the Next.js/Supabase modular monolith and existing role enforcement.

## User Stories
1. As a coordinator, I can edit policy content or dates without silently removing its accountable owner.
2. As a coordinator, I can see and deliberately change or clear the policy owner.
3. As a coordinator, I see saving, saved and recoverable error feedback while editing a policy; duplicate saves are disabled while pending.
4. As an employee, I am offered acceptance only for an approved policy; unpublished policy states explain why acceptance is unavailable.
5. As a coordinator, I can complete a scheduled policy review and receive one new task for a later review cycle.
6. As a coordinator, I can reopen a recurring task to correct it and complete it again without duplicating its successor.
7. As a reviewer, I retain completed tasks and accepted evidence as history through those corrections.
8. As an operator, I can inspect assets already linked to a risk directly while reviewing that risk.
9. As an operator, I understand that an assessment starts a control decision review, without assuming answers automatically establish applicability.
10. As a keyboard or mobile user, I can reach these actions with legible labels, visible focus and no clipped controls.
11. As leadership, I can distinguish existing records, human review, evidence freshness and provider verification.

## Implementation Decisions
- Reuse existing policy server actions, authenticated task RPCs, daily sweep and tenant-scoped reads. No persona-based permission changes.
- Missing owner input preserves current ownership; an explicit empty owner selection deliberately clears it. Policy form exposes the existing owner field.
- Approval and employee acceptance remain separate. This increment does not introduce a new reapproval rule for approved content edits.
- Recurrence is idempotent per source occurrence. Policy review deduplication must permit a later scheduled cycle while preventing same-cycle retries.
- Preserve historical tasks and existing fixtures. Database changes are additive migrations, tested only against the isolated fictional local database.
- Existing asset-risk relationship becomes navigable in both directions; no new register or Member route authority.
- Generic collector observation identity and error visibility require their own subsequent specification after reproducing source findings; do not silently overwrite immutable evidence.

## Testing Decisions
Use established public boundaries: actual browser forms and pages; existing policy action tests; authenticated task RPC and pgTAP transaction fixtures; daily sweep interface. Observe stored outcomes through the same supported reads. Write a red regression for each behavioral defect before changing it, then run focused checks. Use real local database constraints for recurrence. Browser demonstration covers desktop/mobile and policy lifecycle, with synthetic accounts. Full unit/type/lint/build and affected DB/browser checks close integration. Independent standards and specification reviews compare with the recorded start.

## Out of Scope
New permission systems; redesigned approval semantics; automatic risk/finding closure; certification claims; new integrations; destructive data operations; hosted deployment; real employee/customer records. Live-provider and hosted/human acceptance need separate evidence and are not inferred from local checks.

## Further Notes
Latest user direction expressly broadens ongoing company coordination beyond the Mukta/Charlie baseline example. Existing local backlog is the tracker and release checklist remains the sole overall status source. Source findings are hypotheses until their exact behavior is reproduced. Wider collector work is tracked separately rather than slipped into policy/task changes.

## Independently actionable collection failure visibility
The observation-history choice is pending. Independently, generic collection must count provider, evidence and proposal persistence failures once per source, continue other sources, and expose safe failure state/time on its valid linked same-workspace connection. Preserve last successful collection time. Mark success only after all items and required persistence for that source finish; never revive paused/revoked connections, including concurrent status changes. Do not store raw provider errors or alter previous evidence/proposals. The existing collector interface and connection health fields remain the contract; this increment adds no evidence records, permissions or provider enablement.
