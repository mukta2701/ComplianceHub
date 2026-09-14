# Policy workspace refinement

Starting point: `d938edf6461701155dafb7aff776b6bf6ece9b19` on 10 September 2026.

## Problem Statement

ComplianceHub already supports authoring, approval, employee acceptance, material content revisions, feedback, evidence links and scheduled policy-review tasks. The library and detail pages do not yet make this operating journey clear. Owners and review deadlines are difficult to scan, document reading competes with administrative panels, and evidence and existing review work do not provide useful navigation from the policy.

Several reliability gaps undermine that experience. Failed or capped reads can appear as an empty library, a missing policy, no evidence or complete-looking acceptance figures. Authoring lacks the recoverable saving already present in editing. Edit protection compares the content version, which deliberately does not change for title, owner or review-date edits, so competing metadata edits can overwrite one another. Approval and status actions do not confirm that a matching row changed. Acceptance records the version current at execution, allowing someone reading an older version to unknowingly accept newer content.

## Solution

Complete one connected Policy library → author/edit → approve → employee acceptance → review context increment. Apply the approved product-wide visual direction to a readable document workspace with clear accountability, acceptance and next actions. Preserve the existing policy lifecycle and permission boundaries while making reads truthful, authoring recoverable, edits concurrency-safe and acceptance specific to the content version shown to the employee.

## Existing Capabilities and Settled Semantics

- Owner and Admin operators manage policies, approval, status, evidence links and feedback resolution. Assignment as a policy owner records accountability and does not grant an ordinary Member editing or approval authority. Earlier owner-only descriptions are superseded by the current capability matrix and database hardening.
- Members can open the curated policy library and approved policy details, record their own acceptance and collaborate on approved-policy feedback. They do not receive the organisation acceptance roster or management controls. Their portal does not permit the Evidence workspace; this increment does not broaden it.
- Existing statuses are Draft, In review, Approved and Archived. They are operator-controlled states, not a newly enforced mandatory four-step sequence. Only approved policies are available for personal acceptance and Member policy access.
- The database increments the content version exactly once for a material change to whitespace-normalised policy body text. Whitespace-only changes, reference, title, owner, review date and status changes do not increment that version. Material content edits currently retain the existing approval status and require re-acceptance; mandatory reapproval is not part of this increment.
- Policy acceptance is a verified user's own recorded acknowledgement. The database derives identity, workspace, version and timestamps. Only trusted acceptances count in reports. Existing storage retains the latest acceptance row per person/policy, with audit history; it is not an immutable archive of every historical policy body.
- Editing already retains drafts, prevents repeated pending submissions, handles interrupted responses and distinguishes a committed revision with a failed re-acceptance notification from a failed save. These behaviours remain required.
- Feedback records the policy version, author, discussion and resolution. Approved policies permit collaboration; operators retain management of historical threads. Resolving feedback neither edits policy content nor establishes acceptance.
- The daily sweep raises review tasks for approved policies whose review date is reached, using the existing dated-cycle identity and retry deduplication. A missing date means no review is scheduled. Task completion does not itself revise, approve or renew a policy or advance its next review date.

## User Stories

1. As a coordinator, I want policy owner, state, content version and review deadline visible together, so that I can identify the next action without opening every policy.
2. As a reviewer, I want acceptance totals to identify their population and remain accurate beyond a single database page, so that an incomplete response cannot create false confidence.
3. As an employee, I want to find my outstanding approved policies and read their current content, so that I know what I am acknowledging.
4. As an employee, I want acceptance rejected when the displayed content version has changed, so that I never unknowingly accept text I have not read.
5. As an operator, I want the policy document, accountable owner and review context presented clearly, so that administrative controls do not obscure the policy itself.
6. As an operator, I want to create a blank policy or start from an existing template through a recoverable form, so that failed saves do not lose my writing.
7. As an operator, I want a template change to be deliberate when I have an unfinished draft, so that choosing a starting point cannot silently discard my work.
8. As an operator, I want an older edit rejected after another person changes metadata or content, so that ownership and review decisions survive competing saves.
9. As an operator, I want approval and status decisions checked against the record I reviewed, so that a stale page cannot silently apply a decision to changed content.
10. As an operator, I want saved assignments retained even when choice lists are large, so that editing does not accidentally remove the policy owner.
11. As an operator, I want evidence links and existing policy-review tasks to open their source records, so that I can trace the work supporting policy maintenance.
12. As a reviewer, I want acceptance, approval, review-task completion and evidence freshness kept distinct, so that one green status does not imply the others.
13. As a Member, I want my own acceptance and permitted feedback without colleague rosters or management actions, so that the improved workspace preserves my actual access.
14. As any authorised user, I want missing information and unavailable data distinguished with recovery guidance, so that a failed request does not appear to be an empty or completed programme.
15. As a mobile or keyboard user, I want the same policy information and permitted actions in a readable layout, so that the journey remains usable outside a wide desktop screen.

## Implementation Decisions

The following are agreed improvements for this increment, not claims about behaviour already demonstrated.

- Keep the existing routes, policy fields, validation limits, original templates, server-action boundaries and database authority. Reuse the established policy domain, form, application and browser seams rather than introduce another policy subsystem.
- Use a compact graphical library summary and equivalent desktop/mobile records. Operators see reference, title, accountable owner, status, content version, review date and organisation acceptance. Members see only permitted approved policies and their own acceptance. Missing owner/date remain explicitly missing; an unreadable owner or unnamed assigned person must not become unassigned.
- Compute summary and acceptance figures from complete workspace-scoped data or authoritative counts. If the displayed library is capped, disclose that subset while preserving the stated scope of its totals. A partial acceptance list or roster cannot support a complete-looking percentage or outstanding count. Failed primary reads must not become empty states or false 404s; failed supporting reads must remain visibly unavailable and must not enable actions requiring those reads.
- Show the current policy body as readable plain text with intentional typography, wrapping and hierarchy. Keep content reading, approval state, personal acceptance and management controls recognisable as different responsibilities. Do not add markdown interpretation or change stored body meaning.
- Present owner and review date outside the edit form. Distinguish the content version from the technical edit version and from any recorded approval metadata. Existing approval information must not be presented as proof that every subsequent body revision underwent a new approval.
- Preserve the current approved/draft/archived visibility and acceptance rules. Acceptance of an older version remains recognisable as requiring re-acceptance; previously recorded acceptance must not imply a withdrawn policy is currently approved.
- Preserve one consistent, structured author/edit experience with template and blank starts, all fields, explicit owner assignment, field-associated validation, pending protection, safe return/cancel navigation and recoverable save failures. Applying or clearing a template after drafting must not silently replace unsaved content. Preserve the current selected owner outside ordinary option pages and identify an unavailable assignment safely.
- Add a technical compare-and-set edit guard separate from the content version. Pin the original edit token to the draft; server refreshes must not attach a newer token to old input. Every relevant metadata/content/status writer and automatic assignment clearing must remain detectable. Reject zero-row or competing writes, preserve the user's entries and explain how to inspect the latest record. After a confirmed save, use the returned technical token and content version for the next edit, including when notification delivery fails.
- Preserve the database-managed material-edit rule. A non-material edit must not force employee re-acceptance. A material edit must increment once, invalidate current-version acceptance by comparison and preserve the existing notification attempt. Report a committed save and failed notification separately; do not roll back or claim delivery when it was not confirmed.
- Approval and status actions must verify a matching, authorised workspace record and atomically reject a stale decision. They must not report success for zero rows. Keep approval attribution on the approval path and preserve existing status meanings; this does not introduce independent reviewers, new transition rules or mandatory reapproval.
- Bind personal acceptance to the displayed content version and compare it atomically with the current approved version inside the database acceptance boundary. If the version changed or the policy is no longer available, record no new acceptance and ask the employee to read the latest content. Continue deriving user, workspace and timestamps on the server; a submitted expected version is a concurrency check, not permission to choose the stored accepted version. Review existing acceptance entry points so the application cannot silently fall back to accepting an unseen current revision.
- Link operators to managed evidence through the existing permitted destination and show its recorded freshness separately from policy acceptance or approval. Keep unavailable joins recognisable; do not fabricate links. Preserve evidence attachment/unlinking and tenant scope, and refresh affected policy/source views after successful mutations. Members retain only the read-only evidence context allowed today and must not receive navigation into a blocked Evidence workspace.
- Expose existing policy-review tasks to authorised users with their actual owner, due date, state and source navigation. Keep completed, cancelled and outstanding tasks distinct. Use existing relationships and scheduling rules; do not create another review-task mechanism or infer a renewed policy from task completion.
- Preserve feedback discussion, recorded version, historical resolution and current collaboration restrictions. Keep failed feedback reads visibly unavailable. Do not imply a resolved thread changed the policy body or completed acceptance.
- Refresh the policy library and relevant detail/source context after acceptance, editing, approval, status or evidence-link changes so the connected journey reflects confirmed persistence.

## Testing Decisions

- Prefer existing policy page/action/form, acceptance RPC and operating-lifecycle browser seams. Assert saved outcomes, visible facts, permission boundaries and recovery rather than CSS structure or private helpers.
- Cover complete library/acceptance populations beyond the database page cap, accurately labelled displayed subsets, current-version versus older acceptance, missing metadata, unnamed assigned owners and failed primary/secondary reads. Verify Members never receive the organisation roster or non-approved policy content.
- Exercise blank/template creation, owner selection beyond ordinary choice pages, field errors, pending submissions, interrupted responses and draft retention. Verify deliberate template replacement behaviour without discarding an unfinished draft accidentally.
- Test two competing metadata edits and two competing material edits through the action and database boundaries. The earlier draft must not overwrite the newer record; body versions must still change only for material content. Include approval/status changes and owner removal where they affect the edit guard. Verify a server refresh preserves the draft's original token and a confirmed save advances it safely.
- Test approval/status zero-row, stale-record and cross-workspace cases. Preserve Owner/Admin authority and denial for ordinary Members even when assigned as policy owner.
- Test acceptance against the displayed version atomically: read v1, change to v2, submit v1, observe no new acceptance, then read and explicitly accept v2. Include archival before acceptance, unverified/cross-workspace calls, repeat acceptance, trusted-row reporting and server-derived identity/timestamps. Preserve prior data and audit behaviour.
- Preserve tests distinguishing a saved body revision from notification failure. Verify non-material edits retain current acceptances and material edits require re-acceptance without adding mandatory reapproval.
- Demonstrate with realistic fictional operator and employee accounts in the supported local production build: author from a template, retain ownership through edit, approve, read and accept, revise and re-accept, reject stale editing/acceptance, inspect feedback, open linked evidence as an operator and navigate existing review tasks. Verify authorised link/unlink actions and library/detail refresh.
- Inspect library, document detail and author/edit at representative desktop, tablet and narrow mobile sizes. Verify no unintended page overflow, long content wrapping, keyboard reachability, visible focus, associated labels/errors, loading/empty/error recovery and automated accessibility checks. Capture useful before/after interface evidence and iterate on visible defects.
- Run relevant policy/trusted-acceptance/versioning database permission and integration checks, the affected automation regressions, repository checks and independent standards/specification reviews against the starting commit. Resolve material findings and rerun affected checks before closeout.

## Out of Scope

- Rich-text or markdown editing/rendering, a table-of-contents generator, immutable policy-body revision archives/diffs, e-signatures or legal attestation workflows.
- New approval roles, an independent-review requirement, a mandatory status sequence or automatically withdrawing/reapproving every material edit.
- Policy-to-control mappings, private feedback notifications, new evidence access for Members, automated policy generation or provider verification claims.
- New review schedules, automatic advancement of the review date, or automatic policy approval/renewal from task completion or feedback resolution.
- Destructive migration of historical acceptance/content records, hosted deployment, live-provider verification and intended-user acceptance.

## Further Notes

The approved mockups guide hierarchy, typography, spacing and graphical presentation; synthetic counts and unfamiliar actions are not requirements. This increment improves the policy part of the ongoing company-wide compliance lifecycle. The release checklist remains the sole overall project status source. The source audit and this specification establish planning evidence only; implementation, passing automated checks, local demonstration, live-provider verification and hosted/human acceptance remain separate levels of proof.
