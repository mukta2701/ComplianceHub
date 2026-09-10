# Asset workspace refinement evidence — 10 September 2026

## What changed

Before this batch, the Asset inventory hid the real in-app owner, used a wide table on small screens, and did not explain when a displayed list was capped. Detail pages mixed descriptive location with accountability, weakly exposed linked-risk context, and could turn failed reads into reassuring empty or missing states. Create and edit duplicated a long form, lost drafts after recoverable failures, and allowed a stale tab to overwrite a newer record. Existing import and export paths could silently omit a requested category, allocate a conflicting generated reference, or return only the first database response.

Now the register presents exact total, high-criticality, highly-confidential and unassigned counts, with an explicit display-cap message when applicable. Desktop records become equivalent cards at tablet and phone widths; reference, name, category, owner, classification, criticality, location, linked-risk count and authorised actions remain visible. CSV and XLSX are separate visible actions.

Asset detail separates handling, business criticality, accountable membership, descriptive Owner & Location, recorded information date and the system edit date. Linked risks include status and residual exposure, navigate in both directions, and distinguish unavailable data from no relationships. Recorded security controls are described as context rather than reviewed evidence.

Create and edit now share one grouped, labelled form with required/optional cues, help text, visible focus, pending feedback, field errors, Cancel, and draft preservation. An atomic technical edit version rejects stale saves. A database trigger advances that version when a category or owner is removed automatically, so older drafts cannot hide those changes.

Asset import now completes workspace category/reference reads, reports dependent category failures safely, and reserves existing, explicit and generated references. Explicit In-app owner assignment remains separate from descriptive location. Export pagination returns all rows in the existing CSV/XLSX contract or fails instead of returning a partial file.

## Fresh verification

The verified source starts at `6fb6a9166d38969fa9de8d0886abfda45a82d078` and is committed as `3a050a0eeefcc294a9213259a0f367ba6a4087ae` on `codex/team-baseline`.

- Full unit suite under the local resource guard with four workers: 318 files passed; 2,741 tests passed and three intentional skips. The smaller worker pool avoids the Mac memory contention observed with unrestricted parallelism.
- Lint, TypeScript and production build: passed.
- Local integration suite against preserved isolated Supabase API `55321`: five files and eight tests passed.
- Full local database suite: 100 pgTAP files and 2,220 assertions passed, including the new technical-version trigger checks. No database reset was used.
- Production browser: asset create/read/edit, atomic stale-save rejection, owner assignment, risk link/navigation/unlink, CSV and XLSX responses, and automated accessibility checks passed on desktop and mobile.
- Production browser import: explicit owner, descriptive location, ambiguous/unknown-owner rejection and persisted results passed on desktop and mobile.
- Member access: direct operator registers including Assets and new routes still redirect to the curated Member portal; desktop and mobile checks passed.
- Independent specification and standards re-reviews found no remaining material issue. A separate visual reviewer inspected register, detail, new and edit at 1440, 883 and 393 pixels; the final spacing and mobile criticality wording were refined afterwards and the affected browser journey passed again.
- Permanent local preview: the immutable package for source `3a050a0` runs at `http://127.0.0.1:3300/app/assets`. Fresh health reports application and database OK with the exact source SHA. An actual in-app-browser screenshot shows the preserved fictional workspace and its asset record.

This proves local code, automated checks and fictional local production behaviour. It does not prove a hosted release, live-provider operation or human stakeholder acceptance.

## Visual evidence

- [Asset register — desktop](asset-workspace-2026-09-10/register-desktop.png)
- [Asset register — mobile](asset-workspace-2026-09-10/register-mobile.png)
- [Asset detail — desktop](asset-workspace-2026-09-10/detail-desktop.png)
- [Asset detail — mobile](asset-workspace-2026-09-10/detail-mobile.png)
- [Explicit-owner import preview — desktop](asset-workspace-2026-09-10/import-preview-desktop.png)
- [Explicit-owner import preview — mobile](asset-workspace-2026-09-10/import-preview-mobile.png)
- [Saved imported owner — desktop](asset-workspace-2026-09-10/imported-owner-desktop.png)
- [Saved imported owner — mobile](asset-workspace-2026-09-10/imported-owner-mobile.png)

The screenshots use newly created fictional workspaces. Existing records were preserved.

## Deferred work

Direct asset-linked tasks or evidence, a separate asset approval/review lifecycle, automatic discovery, recurring asset review schedules, live-provider verification and full relationship export/import roundtrip remain deferred. The next product increment should refine the policy lifecycle using the same truthful status, responsive hierarchy and recoverable-action standards.
