# Explicit accountable owners in asset imports

Starting commit: `4fe6d87`. Owner approved a separate explicit owner column on 9 September 2026. This supersedes the owner inference rule in the phase-B.5 import design; that historical document remains intact. Overall status remains in the release checklist.

## Problem Statement

Owner & Location is descriptive text, but asset imports currently use it to assign a workspace member with a matching name. A location called London can therefore assign a person named London. Ordinary asset editing already separates location and accountable owner. Users need predictable assignments and an honest preview before adding assets.

## Solution

Add an optional In-app owner import column. Preserve Owner & Location as descriptive text only. Resolve an explicit owner by a unique current-workspace display name, ignoring case and surrounding spaces. Blank or unmapped owners create unassigned assets. Unknown or ambiguous names, or an unavailable member lookup, flag the affected named-owner rows and prevent their import. Recheck at confirmation because membership may have changed since preview.

## User Stories

1. As a coordinator, I can import location text without accidentally assigning someone.
2. As a coordinator, I can explicitly assign an asset to one known workspace member.
3. As a coordinator, I can leave ownership blank and see that it remains unassigned.
4. As a coordinator, I see invalid owner rows during preview and can correct the file before confirmation.
5. As a reviewer, I can reopen an imported asset and inspect its actual saved owner and location.
6. As a coordinator, I understand that current exports do not preserve in-app owner assignments or risk links.

## Implementation Decisions

Reuse the existing shared wizard, asset adapter and authenticated import action. Add asset-specific strict owner resolution without changing risk/SoA name matching. Both preview and commit use current workspace membership. A failed or incomplete member list cannot establish uniqueness; flag named-owner rows instead of choosing from partial data. Exclude invalid owner rows from valid counts, show row errors, and include skipped-row explanations after confirmation. Do not silently assign ambiguous matches or interpret location as authority. Existing permissions, tenant filters, database rules and additive import behaviour remain unchanged. Show concise guidance beside asset upload, including current export limitations.

## Testing Decisions

Use the existing public import-action and adapter interfaces for behavioural red/green regression checks, plus an actual desktop/mobile browser upload→map→preview→confirm→saved asset journey with fictional local data. Cover location-only, explicit unique name, whitespace/case, absent owner, duplicate/unmatched names, lookup failure, workspace scoping and membership changes between preview and commit. Existing permission-denial tests remain required. Run heavy checks sequentially under the local resource guard. Independent standards/specification review uses the recorded starting point.

## Out of Scope

New export columns, risk-link roundtrip, schema migrations, permission expansion, rewriting historical assets, global unique display names, fuzzy matching, invitation workflows, live-provider or hosted deployment, and import deduplication across separate requests.

## Further Notes

The preview is a current validation result; final server validation remains authoritative. A member removed during the operation remains subject to existing database constraints. No claim of atomic preview reservation or locking all membership changes is made.
