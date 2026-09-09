# Confirm the import that was previewed

Starting commit: `068384e`. Part of the existing operating-lifecycle quality programme. Overall status remains in the release checklist.

## Problem Statement

After previewing an import, an operator can change column mapping or the target SoA register while the old confirmation remains. Confirm then submits the current settings, although the visible preview describes different settings. An in-flight preview can likewise complete after its inputs change.

## Solution

Changing import settings requires a fresh preview; selecting another workbook clears the previous analysis. Keep those inputs stable while analysis, preview or confirmation is pending. Consume the current preview on confirmation so the same displayed approval cannot be submitted again.

## User Stories

1. As an operator, I want confirmation to apply to the mapping I reviewed.
2. As a control reviewer, I want changing the target register to require another preview.
3. As an operator, I want input controls locked during pending work so an older result cannot be mistaken for my current request.
4. As an operator, I want the completed result shown without a remaining button that resubmits the old approval.
5. As an operator, I want a fresh preview to restore confirmation after I change my choices.
6. As an operator, I want choosing another workbook to remove the previous workbook’s analysis and approval.

## Implementation Decisions

Reuse the shared import wizard and existing server actions. Invalidate prior preview/results on mapping or register changes. Selecting another file clears headers, rows, mapping and prior results until it is analysed. Disable workbook, register and mapping controls while a transition is pending; existing action buttons already disable. Remove the consumed preview when confirmation begins. Preserve parsing, validation, import ownership semantics, counts, data writes, roles and tenant checks.

## Testing Decisions

Use the rendered wizard's public form/control/action interface and actual local browser import flow. Reproduce the stale confirmation before its fix. Cover mapping changes, register changes, delayed preview inputs and consumed confirmation. Component tests submit the form directly after supplying a fictional file because the JSDOM file-input validity emulation does not trigger the click-based submit; real-browser file upload is verified separately. Run appropriate full checks sequentially with the resource guard and independently review standards/specification against the starting commit.

## Responsive mapping refinement

The actual mobile screenshot revealed mapping selectors outside the393px viewport: the selected control ended at649px because the shared table imposed an800px minimum. Keep the desktop two-column presentation and stack each source-column label with its selector on small screens. Use normal labelled form controls and scoped styles. Browser acceptance must check selector bounds, not just document overflow; capture screenshots from the top of the page to avoid sticky-header capture artifacts.

## Out of Scope

Changing asset-owner inference, new owner columns, export expansion, database migrations, import idempotency across distinct requests, hosted changes and external messages. The old asset design explicitly permits name inference from Owner & Location; that conflict is awaiting an owner decision. Its failing regression is preserved privately until the decision is settled.

## Further Notes

This prevents accidental use of a stale client preview. Server-side validation remains authoritative and can still reject data that changes before commit. It does not make separate repeated imports idempotent.
