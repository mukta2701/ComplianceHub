# Proof-to-audit Evidence vault refinement

## What changed

Before this batch, Evidence rendered as a long collection of equally weighted records. Freshness, selection and linked compliance work were difficult to scan; a filtered or out-of-range page could look like an empty product; file, link and note fields appeared together; and official GitHub evidence replaced rather than complemented the normal evidence record.

After this batch:

- the route is a two-pane vault with a compact evidence list and one selected record;
- source-backed freshness summaries and filters distinguish current, expiring, expired and historical evidence;
- an elapsed validity date takes precedence over a stale saved `current` label without rewriting the historical record;
- pagination clamps impossible page numbers and a filter with no matches explains the filter result rather than showing first-use guidance;
- each selected record shows dates, source, description, linked controls and related work together;
- official GitHub records retain trusted repository provenance inside that normal record context and hide unsupported editing controls;
- incomplete legacy automation records retain any available external reference while stating that the collection identity is unknown;
- superseding and withdrawing are separate, explained actions; withdrawal requires a second deliberate confirmation and retains history;
- the Add evidence form shows only the source field that will be saved and rejects missing or historical replacement targets;
- desktop, tablet and phone layouts retain the complete Evidence → Monitoring → Audits journey and fit long record labels without page-level horizontal scrolling.

The page still distinguishes a collected result from human review and from a provider-verified resolution. It does not turn evidence freshness into a compliance conclusion.

## Visual evidence

- Approved direction: [proof-to-audit mock-up](../design/2026-09-09-product-mockups/07-proof-to-audit-oversight-feasible.png)
- Implemented local production Evidence vault: [1440px desktop](proof-to-audit-evidence-vault-2026-09-10/evidence-desktop.png), [883px tablet](proof-to-audit-evidence-vault-2026-09-10/evidence-tablet.png), [393px phone](proof-to-audit-evidence-vault-2026-09-10/evidence-mobile.png)
- Implemented Add evidence form: [393px phone](proof-to-audit-evidence-vault-2026-09-10/evidence-new-mobile.png)

All records shown in these screenshots are fictional local test data created for interface verification.

## Fresh verification

Verified on 10 September 2026 in the isolated local ComplianceHub worktree against fictional local Supabase data:

- focused Evidence and baseline logic: 14 files and 53 tests passed;
- evidence schema and evidence-to-audit database behavior: 2 files and 16 pgTAP tests passed;
- TypeScript checking passed;
- lint passed;
- the Next.js production build passed;
- the representative production browser suite passed at 1440px, 883px and 393px, including no page-level horizontal overflow, zero serious or critical automated accessibility findings, mobile conditional source fields and reduced-motion behavior;
- the full production browser workflow passed in 19.1 seconds, creating and connecting an assessment gap, accountable task, control review, expired evidence, replacement evidence, withdrawal, audit record, activity entry and leadership report;
- the test contracts for the separately prepared dated-observation and saved-showcase fixtures were updated and discovered successfully; those optional fixture journeys were not recreated for this batch.

The app-level authorization tests prove that a Member is rejected before an Evidence mutation and that an Owner reaches the existing create, link, unlink and withdraw interfaces. The unchanged database access policies remain covered by the existing permission suite; this batch did not alter database grants or schema.

These checks prove the implemented code, local production build, fictional local behavior and automated accessibility scan. They do not prove a hosted release, live-provider behavior, a fresh external provider check, screen-reader acceptance, human stakeholder acceptance or certification readiness.

## Running preview and source identity

Application source `830e2eb` is pushed to the existing `codex/team-baseline` branch. Its immutable production package is the source intended for the background preview at http://127.0.0.1:3300/app/evidence. The final background health and exact release identity are rechecked after this evidence note is committed.

## Architecture boundary

Freshness is derived in one Evidence domain function and reused by the programme summary. The route applies the same date rules to list filters, counts and record labels. Existing Evidence rows remain immutable history; this display correction does not silently rewrite them. Existing Server Actions remain the write interface, with the route adding an explicit operator check before input parsing or mutation. No database migration, provider contract or background-job behavior changed in this batch.
