# Explicit asset-import ownership evidence

Starting source `4fe6d87`. [Specification](../superpowers/specs/2026-09-09-explicit-asset-import-owner.md). The owner explicitly approved superseding Owner & Location inference with a separate In-app owner column. The release checklist remains the overall status source.

## Observed before

Historical real-action regression assigned a member from descriptive location text. Fresh production browser reproduction against the last verified app found that an uploaded In-app owner column was not recognised or mapped (expected ownerName, received empty). That run stopped before confirming an import. No existing records were changed; fixtures are new fictional local workspaces.

## Bounded result

Location text is descriptive only. Optional In-app owner matches a unique current-workspace display name, ignoring case and surrounding spaces. Blank/unmapped owners stay unassigned. Ambiguous/unmatched names and failed/incomplete membership reads flag affected rows and exclude them; the action rechecks at confirmation. Guidance explains the field and unchanged export omissions. No historical assignments, database schema or permissions are changed.

## Verification

Fresh checks on 9 September 2026:

-13 focused action/adapter tests pass. Red/green coverage includes implicit location assignment, explicit mapping, ambiguous/unmatched owners and incomplete member lists. Additional coverage checks failed lookup and membership removal/cross-workspace replacement between preview and commit.
- Full unit suite:306 files,2,634 tests passed and3 existing skips. Typecheck, full ESLint and production build pass.
- Fresh local asset database suite:21 assertions pass, including workspace isolation and owner-membership integrity. Schema and permissions are unchanged.
- Final packaged production browser:2/2 desktop/mobile journeys pass against isolated local API55321. A four-row fictional import recognises the new field; preview reports2 valid and2 invalid rows; only the safe two are inserted. Reopening assets shows descriptive London with Unassigned ownership, versus explicitly assigned London with London office location. Duplicate and unknown owner rows are absent from the inventory.
- Keyboard confirmation works. Targeted axe checks find no serious/critical WCAG A/AA violations in the preview, and no document horizontal overflow is observed. This is not full accessibility certification.
- Independent [Standards and Specification reviews](2026-09-09-explicit-asset-owner-review.md) report no material findings; final screenshot review is recorded there.

All fixtures are newly created fictional local workspaces. Existing records were preserved. Runtime health/Git closeout follows below. These results do not establish live-provider behaviour, hosted deployment or human acceptance.

## Screenshots

| State | Desktop | Phone |
|---|---|---|
| Explicit mapping and unsafe-name feedback | [View](explicit-asset-owner-2026-09-09/owner-preview-chromium.png) | [View](explicit-asset-owner-2026-09-09/owner-preview-mobile.png) |
| Saved explicit owner and descriptive location | [View](explicit-asset-owner-2026-09-09/saved-owner-chromium.png) | [View](explicit-asset-owner-2026-09-09/saved-owner-mobile.png) |
