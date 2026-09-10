# Asset workspace refinement

Starting point: `6fb6a9166d38969fa9de8d0886abfda45a82d078` on 10 September 2026.

## Problem Statement

The existing asset lifecycle supports manual records, categories, accountable owners, linked risks, spreadsheet imports and exports. Its screens do not yet present those capabilities as one clear journey. The register omits the actual in-app owner and places key information in a wide table. Create and edit repeat a long form, do not recover entered values after failures and allow an older edit to overwrite newer data. Several failed reads appear as empty lists, unassigned ownership or a missing asset. Changes to risk links do not consistently refresh both sides of the relationship.

The lifecycle also has two material data-transfer defects. Asset imports can silently drop a requested category when category loading or creation fails, and count-based generated references can collide with existing references. Exports use a single capped database response, so a larger inventory can produce an incomplete file without telling the user.

## Solution

Complete the existing Asset inventory → asset detail → create/edit → linked risk journey with the visual hierarchy established by the approved product-wide mockups and the refined Tasks and Risks workspaces. Make metadata, ownership and relationship context readable on desktop and mobile. Make saving recoverable and protect against stale edits. Repair the existing import category/reference and export-completeness defects as part of maintaining the same inventory reliably. Preserve existing permissions, field meanings, explicit import ownership and additive import behaviour.

## User Stories

1. As a coordinator, I want to see asset reference, description, category, in-app owner, classification and criticality together, so that I can identify the record and its accountability quickly.
2. As a reviewer, I want inventory counts to identify their scope and remain accurate beyond one database page, so that an attractive summary does not conceal missing records.
3. As a mobile user, I want the same record information and navigation in readable cards, so that important context does not disappear on a smaller screen.
4. As a reader, I want descriptive Owner & Location text kept separate from the accountable in-app owner, so that a location or name in free text does not imply assignment.
5. As a reviewer, I want asset details to connect recorded handling information and linked risks, so that I can trace the context without treating recorded controls as verified evidence.
6. As an operator, I want to create and edit through a consistent grouped form, so that I can recognise the fields and complete the work efficiently.
7. As an operator, I want validation and save failures to preserve my draft and identify the correction, so that I do not have to enter the record again.
8. As an operator, I want an older edit rejected without losing my input, so that another person's changes are not silently overwritten.
9. As an operator, I want existing owner and category selections retained when option lists are large, so that opening an edit does not clear a valid assignment.
10. As an operator, I want linking and unlinking a risk to update both records, so that navigation in either direction reflects the saved relationship.
11. As a Member, I want direct asset pages and exports to remain outside my curated portal, so that the redesign does not silently broaden my actual authority.
12. As an importer, I want a requested category either saved correctly or reported as unresolved, so that a successful import does not silently lose classification context.
13. As an importer, I want generated references to avoid existing and explicit batch references, so that sparse numbering does not cause avoidable skipped rows.
14. As an authorised exporter, I want CSV and XLSX files to include the complete inventory covered by the existing export contract, so that a large workspace does not lose rows silently.
15. As any authorised user, I want unavailable data and failed actions explained safely with a recovery path, so that I can distinguish a failed operation from an empty or successfully updated record.

## Implementation Decisions

- Preserve existing asset routes, field validation and database constraints. Reuse the established server-page, form-action and behavioural-test seams rather than introduce a new asset framework.
- Owner and Admin retain asset-page, export, create, edit, delete, link, unlink and import authority. Members remain restricted to the existing curated portal, which does not include asset routes or asset exports. Database read policies remain defence in depth; the redesign does not broaden request-level access. All reads and mutations remain workspace scoped; interface visibility never substitutes for server and database enforcement.
- Classification remains a handling category; value criticality remains a separate recorded assessment. Security controls remain descriptive text. None is a compliance score or proof of successful collection, human review or technical verification.
- Keep `Owner & Location` descriptive and `In-app owner` an explicit workspace-member assignment. Blank values remain recognisable as missing; a failed owner lookup must not become “Unassigned”. Preserve the approved explicit-owner import decision, including unknown and ambiguous-name handling and confirmation-time revalidation.
- Distinguish the user-entered Last Updated date from the technical record version. Do not relabel either as a completed asset review or evidence freshness.
- Present a compact inventory summary and readable records using the existing application visual language. Summary totals must either cover the complete workspace population through authoritative queries or explicitly describe their displayed subset. Disclose any register display cap; do not infer complete counts from a capped response.
- Give desktop and mobile users equivalent reference, description, category, accountable owner, classification, criticality and detail navigation. Keep import, export and management actions clear and available only as authorised.
- Check material primary, category, owner and relationship reads. A database failure must not become an empty state, an invented default, an unassigned owner or a 404. A genuine successfully queried missing asset may return not found. Failed choice loading must not enable destructive clearing of saved choices.
- Linked risks retain their existing reference, title and navigation; a missing or unavailable join must not generate an undefined URL or masquerade as no relationship. Keep all existing link/unlink/delete capabilities and constraints. Refresh affected asset, inventory and reciprocal risk views after successful mutations.
- Share a structured create/edit form with associated labels, concise field help, field errors, save feedback, pending protection and a clear return/cancel route. Preserve all existing fields, defaults and validation limits. Preserve a draft after validation, write and stale-edit failures.
- Pin the edit draft and its original technical version together. Use an atomic compare-and-set guard for metadata updates; a zero-row update is not success. Another write, reassignment or membership/category removal must not be overwritten by an older draft. Ensure relevant concurrent writers and automatic relationship clearing are detectable by the guard. A refreshed server render must not silently attach a newer version to the old draft.
- Preserve a current valid owner/category selection even when the ordinary choice page omits it. If the selected entity no longer exists or cannot be read, surface the condition rather than silently substituting another value.
- Imports remain additive and preserve their existing mapping → preview → confirmation safeguards. Resolve named categories against complete workspace-scoped data. Failed category reads or creation must stop the dependent operation or report the affected row as skipped; they must never import a named category as blank while reporting success. A deliberately blank category remains valid.
- Preserve supplied asset references. Allocate missing references using the complete workspace uniqueness scope and reserve explicit references in the applicable import batch before generating defaults. Account for earlier generated references in that batch. A failed reference read must not be treated as an empty inventory. Database uniqueness remains authoritative; concurrent collisions must produce accurate recoverable outcomes rather than an invented atomic reservation guarantee.
- Preserve accurate imported/skipped totals and safe row-level explanations, including partial outcomes. Do not expose raw database diagnostics to users. Shared import helpers must retain the behaviour of other import types when touched.
- Export every row in the existing CSV/XLSX column contract using deterministic pagination beyond the database response cap. If any required page fails, return a clear failure instead of a successful partial file. Preserve workspace isolation, export protections, formats and audit recording. The result is not promised to be a transactionally frozen snapshot during concurrent writes.
- Continue explaining existing export limitations: descriptive ownership is exported, while in-app owner assignment and linked-risk relationships are not restored by an export/import roundtrip. This batch does not add relationship columns or claim full-fidelity backup.

## Testing Decisions

- Prefer existing asset page/actions, import confirmation and export route seams. Assert visible facts, authorised saved outcomes and failure recovery rather than component structure or CSS class names.
- Cover register counts beyond the database page cap, explicit subset labels where applicable, missing metadata, failed primary/secondary reads, and selected owner/category retrieval beyond ordinary option lists.
- Cover Owner/Admin management, Member request-level denial, cross-workspace denials and no-row mutation failures. Run relevant database permission/integrity checks when those behaviours or version protection change.
- Test a stale edit through the form action and database-backed/browser journey: another update wins, the old save is rejected and its draft remains available. Include assignment/category removal where it can bypass ordinary metadata writers. Test successful updates and inventory/detail refresh as well as validation and write failures.
- Extend existing import tests with sparse references, a blank reference before an explicit batch reference, failed/incomplete category or reference reads, category creation failure, blank category and accurate partial outcomes. Preserve explicit-owner ambiguity and preview invalidation coverage. Cover other import types if shared behaviour changes.
- Exercise CSV and XLSX export with more rows than one database response, checking complete row identities and existing fields, tenant exclusion, page failure and normal export protection/audit behaviour.
- Demonstrate with fictional data in the supported local production build: create, inspect, edit, stale edit, link a risk, navigate both ways, unlink, import and export. Verify the actual owner, descriptive location, category, classification and criticality persist correctly. Preserve unrelated existing data.
- Inspect the register, detail and shared forms at representative desktop, tablet and narrow mobile widths. Verify no unintended page-level horizontal scrolling, long-value wrapping, keyboard reachability, visible focus, associated labels/errors, pending/error feedback and automated accessibility checks. Capture meaningful interface evidence and iterate on visible defects.
- Run independent standards and specification reviews against the recorded starting commit, resolve material findings and rerun affected checks. Keep implementation, automated checks, local demonstration, live-provider verification and hosted/human acceptance distinct.

## Out of Scope

- Direct asset-linked tasks or evidence, a new asset review/approval workflow, recurring asset review schedules, lifecycle states or history models.
- Automatic asset discovery, provider integrations, live technical verification or AI-generated assurance claims.
- New compliance scores, invented trend charts or aggregation that merges classification, criticality, task completion and evidence freshness.
- Full relationship roundtrip or backup/restore, new owner/risk export columns, deduplication across separate additive imports, or transactional snapshot guarantees for concurrent import/export activity.
- Unrelated import redesigns, destructive cleanup of existing records, hosted deployment, live-provider verification and intended-user acceptance.

## Further Notes

The approved mockups guide hierarchy, typography, spacing and responsive behaviour; their fictional counts and unfamiliar actions are not requirements. This increment strengthens the asset part of the broader ongoing compliance lifecycle without presenting it as the whole product. The release checklist remains the sole overall status source. Source inspection established the problems above; completing this specification does not establish passing checks or demonstrated application behaviour.
