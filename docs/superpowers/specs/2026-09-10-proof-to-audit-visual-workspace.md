# Proof-to-audit visual workspace

Starting commit: `3bea8d9`.

## Problem statement

ComplianceHub already stores evidence, monitoring results and audit work, but these pages feel like separate administrative screens. Operators cannot quickly answer which proof is current, what needs action, and which audit conclusion a record supports. On small screens, important audit status and checklist information is pushed off-screen. The Evidence page also derives authoritative-looking totals from only its newest 200 records.

The rendered UI hides Evidence mutations from Members and the current database policies correctly reject those writes. The Server Actions themselves do not perform the same explicit role check, even though they are directly reachable server interfaces. This makes the permission contract harder to understand and defend.

## Solution

Build one connected visual language for **Evidence collected → Systems watched → Controls audited**. Start with a complete Evidence vault and audit-detail linkage increment, then apply the same hierarchy to the Audit register and Monitoring.

The Evidence vault will show exact workspace totals, explicit filtering and page scope, a scannable record list, and a focused detail surface. It will keep evidence freshness, source provenance and human review as separate concepts. Audit checklist evidence will reuse the same proof-record presentation and become readable cards on phones. Evidence-changing Server Actions will reject Members before attempting a database write, while the existing operator-only RLS remains the database backstop.

## User stories

1. As a compliance coordinator, I want exact evidence totals so that I can trust the workload summary.
2. As a compliance coordinator, I want to filter records by freshness so that I can address expiring and expired proof first.
3. As a compliance coordinator, I want the visible result count and page scope stated so that a partial list is never mistaken for the whole vault.
4. As a reviewer, I want to select one evidence record and see its dates, source, links and content together so that I can assess it without scanning a wall of cards.
5. As a reviewer, I want automated-source provenance kept with the record so that I can trace where the proof came from.
6. As a reviewer, I want freshness and human review described separately so that current evidence is not mistaken for approved evidence.
7. As an operator, I want to link, supersede and withdraw evidence from a clear management area so that governance actions are deliberate.
8. As a Member, I want a read-only evidence experience so that I cannot accidentally change governed records.
9. As an authorised auditor or operator, I want linked evidence visible beside a checklist item so that an audit conclusion can be traced to proof.
10. As a phone user, I want audit checklist items to become readable cards so that status, evidence and next actions are not hidden in a wide table.
11. As a keyboard user, I want visible focus and reachable controls so that I can complete the same journey without a pointer.
12. As a reduced-motion user, I want the final layout without movement so that polish does not block access.

## Implementation decisions

- The existing routes and Supabase data model remain authoritative. No new workflow state is introduced.
- Evidence freshness values remain `current`, `expiring`, `expired`, `superseded` and `withdrawn`.
- Exact totals use count queries scoped to the active organisation; the list is separately paginated and labels the visible range.
- URL search parameters carry freshness filter, page and selected evidence. This keeps filtered and selected states linkable and works with the current Server Component route.
- Page size is 25 records. Invalid filter, page or selected-record values fall back safely.
- A shared proof-record component presents title, kind, freshness, collected/valid dates and linked-record context. Official GitHub provenance remains in its specialised trusted detail component.
- Only Owner and Admin roles may create, link, unlink, supersede or withdraw evidence. Members retain read and file-download access allowed by existing product decisions.
- Server Actions check the operator role before reading mutation input or attempting a write. Existing operator-only RLS remains the second authorization boundary.
- Historical evidence and links are never deleted by this visual work. Withdraw and supersede retain the current lifecycle meanings.
- Audit progress, checklist result, finding status and evidence freshness remain distinct.
- The existing visual tokens provide cobalt actions, teal confirmed state, amber attention, coral risk, violet review and gray neutral/unknown treatments. Route-owned layout moves into scoped CSS modules instead of adding more global selectors.

## Testing decisions

The chosen public seams are the Server Actions, rendered route output, database policies and the browser journey. These match existing project tests and the user's instruction to continue without another planning pause.

- Server Action tests prove a Member is rejected before Evidence link, unlink or withdrawal writes, while an operator reaches the existing Supabase write interface.
- Database tests retain the current operator-only mutation inventory for Evidence and Evidence links.
- Render tests prove exact count queries, URL-filtered/page-scoped output, visible scope language, Member read-only controls and truth-preserving labels.
- Audit render tests prove linked proof context and the responsive card/table structure.
- Browser tests cover 1440px, 883px and 390px without document overflow, verify keyboard focus and check serious/critical accessibility findings.
- Production build and local production rendering are required before completion evidence is recorded.

## Out of scope

- Certification claims, an overall compliance score or a historical monitoring chart.
- New evidence approval state, new audit state or automatic audit conclusions.
- Live-provider enablement, hosted deployment or external auditor acceptance.
- Deleting or rewriting existing evidence records.
- Search across evidence contents; this increment uses freshness filtering and pagination.

## Further notes

The corrected design concept is stored with the product mock-ups. Its values are fictional and its layouts are implementation targets, not evidence that the application works.

