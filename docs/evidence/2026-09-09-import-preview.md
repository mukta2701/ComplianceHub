# Import preview consistency

Starting source: `068384e`. [Specification](../superpowers/specs/2026-09-09-import-preview-consistency.md). The release checklist remains the overall status source.

## Before-change evidence

A fictional coordinator uploaded a valid one-row asset CSV to the local production app, analysed it and previewed one valid row. Changing Asset Description to Ignore left the old Confirm import (1) button visible. The actual browser regression failed with expected confirmation count0, received1. Source inspection confirms the action uses current mappings, so the displayed preview no longer described the settings that would be submitted. No import was confirmed during this before-change reproduction.

The rendered-wizard regression independently reproduced the stale confirmation. Follow-on tests exercise a different target SoA register, delayed analysis/preview/commit responses, consumed confirmation and replacement workbook selection. These tests use fictional server-action results at the component boundary; they do not establish database writes.

## Bounded change

Mapping/register changes invalidate preview and previous results. Another workbook clears the prior analysis. Pending inputs are disabled so in-flight work cannot finish against visibly changed choices. Confirmation consumes its preview and completion retains the result. A new preview is required for any further confirmation.

The confirmation form uses an ordinary submit handler that calls the existing transition-wrapped action. A deferred-action test showed a function-form action kept the preview removal batched with the pending request; the explicit submit handler makes consumption immediate. Actual browser confirmation and persisted output were subsequently verified below.

No server action, parsing, ownership inference, tenant filter or database permission changes are included. This is client preview consistency, not idempotency for separate repeated imports.

## Verification

Fresh local checks on 9 September 2026:

- Full unit suite:306 files,2,628 passing tests and3 existing skips; typecheck, full ESLint and production build pass. These preceded the final responsive-only markup/CSS refinement.
- After that refinement: all6 affected component tests, typecheck, targeted ESLint and another production build pass.
- Final packaged production browser:2/2 desktop/mobile journeys pass against isolated local Supabase (API55321), using new fictional workspaces. Upload, analysis, preview invalidation, replacement workbook, fresh preview, keyboard confirmation and actual persisted replacement asset are demonstrated. Earlier records were preserved.
- A first functional browser run reached the correct asset but expected a reference without the page's ASSET prefix. Correcting that test expectation produced a passing rerun; no application change was required for it.
- Visual inspection then found mobile mapping controls outside the viewport. A new control-bounds assertion reproduced a right edge of649px on a393px viewport. Scoped form rows now retain two desktop columns and stack each label/select on phones. The final bounds check passes, along with no document horizontal overflow and no serious/critical WCAG A/AA axe findings on the checked state.
- Independent Standards, Specification and final desktop/mobile visual reviews report no material findings, including the final responsive delta. [Review record](2026-09-09-import-preview-review.md).

The browser candidate runs on loopback3302; ordinary background3300 remains available during checks. The packaged source fingerprints cover the wizard and stylesheet. Git/background installation is recorded below after completion.

These checks establish local behaviour with fictional data. No database schema, permission or provider behaviour changed; no fresh database permission suite, live-provider verification, hosted deployment or human acceptance is claimed. Consuming a preview does not prevent someone intentionally importing the same workbook again after generating another preview.

## Visual evidence

- [Before: changed mapping retains stale confirmation](import-preview-2026-09-09/before-desktop.png).
- [After: changed mapping requires another preview, desktop](import-preview-2026-09-09/after-desktop.png).
- [After: mobile labels and selectors fit together](import-preview-2026-09-09/after-mobile.png).
- [After: successful fictional import on mobile](import-preview-2026-09-09/completed-mobile.png).

## Separate decision

The original phase-B.5 design explicitly permits resolving an asset owner from Owner & Location. A private action regression reproduced an assignment to a member named London from the location London. The owner has been asked whether to replace that rule with a distinct In-app owner column; no such semantics change is included here. The failing ownership regression and its raw evidence remain in ignored local artifacts pending that decision.

## Git and background-app closeout

Application source `165f975c5755ef8628521f740fab68310f015174` is committed and pushed to `origin/codex/team-baseline`. The checked packaged build is now running independently in the background at http://127.0.0.1:3300/app; its launcher has parent process1 and a1.5GiB Node heap limit. Fresh health reports `status: ok`, `db: ok`, and that exact source SHA. Source fingerprints still match the tested wizard and stylesheet. The existing authenticated fictional session opens the import page in the actual in-app browser after the switch. No database restart or reset was needed.

This is a local background process, not automatic startup after a complete Mac reboot. Approximately12GiB disk remains. Full provider, hosted and human acceptance gates remain open.
