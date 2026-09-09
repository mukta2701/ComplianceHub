# Dated collection observations — 9 September 2026

Implementation starting point: `398e01d`. [Specification](../superpowers/specs/2026-09-09-dated-collector-observations.md) · [Ticket10](../plans/operating-lifecycle-quality/issues/10-dated-collector-observations.md). The release checklist is the overall status source.

## What changed and why

Previously, generic automated collection identified a resource once for its lifetime. A later successful check could leave the first evidence and draft on screen, hiding the later date or changed facts.

Now, a later collection date or changed recorded facts creates a separate observation. Identical retries reuse the same observation. The original resource reference stays recognisable, and older evidence, links and human decisions remain intact. A new observation has its own Automation draft for authorised review; it does not automatically replace reviewed evidence or close work.

Evidence shows its recorded date and resource. Automation shows the date, resource and **Recorded result**, so reviewers can distinguish two different results recorded on the same day. Older records retain their known dates and references with a warning that their observation identity is unknown. Nothing invents missing history.

The owner approved retaining unchanged results on later dates. Dates have day precision: this is not an exact log of every poll. Scheduled generic collection still saves evidence and Automation records; manual baseline/recollection still saves Automation drafts only. The separate official GitHub pipeline is unchanged.

## Fresh verification

- Focused behavioural red/green checks cover identity, later dates, changed facts, retry/concurrency recovery and the existing manual entry points. UI regression checks: 8 files / 41 passing tests, including same-day result differences and known legacy facts.
- Transactional migration rehearsal: 51 passing assertions; all rehearsal changes rolled back. Legacy evidence, source objects, accepted proposals and links remain unchanged.
- Preserved isolated local database (`55321` API / `55322` Postgres): 100 database files / 2,218 assertions pass after the additive migration. Authentication, tenant access, manual evidence permissions, provenance forgery prevention, immutable identity and permitted retention transitions are covered.
- Real local integration: 2 tests pass. The actual collector/parser and database/authentication interfaces save later snapshots, converge under concurrent collection, recover interrupted writes at five persistence stages, retain truthful health and preserve earlier accepted decisions and evidence links. Only the external provider HTTP response is fictional. No live GitHub request was made.
- Full unit suite: 307 files / 2,645 passing tests and 3 pre-existing skips. Typecheck initially caught an overly broad provider type in the generic mapping; it now matches the existing generic caller. Affected 32 tests, full typecheck, lint and production build pass after that correction.
- First production-browser pass: desktop and mobile, 2/2 tests. Keyboard disclosure controls, distinct same-day results, retained earlier task link, legacy known facts and draft-only status pass. Neither viewport overflows; axe reports no serious/critical WCAG A/AA violations.
- Subsequent visual refinement reproduced a 280px-tall mobile dismissal form caused by a desktop flex basis becoming a height in the column layout. A mobile-only flex correction removes the blank gap; the final production-browser rerun passes 2/2, including the form-height limit of less than130px and all original workflow checks. Full typecheck/lint/build and32affected tests also pass after the CSS correction.

Existing-record count/content fingerprints matched before and after the actual migration for evidence, source objects, proposals, evidence links and proposal/source links. New nullable metadata was excluded from this comparison; existing fields were not changed.

## Local migration history limitation

The standard migration command found an older missing ledger entry, `20260909152313_task_contributions`, although its table and assignment-revision column already exist. It failed before applying this change. We did not replay that older migration or reset the database. Only `20260909202805_dated_collector_observations` and its matching ledger entry were applied together in one transaction to the isolated retained database. The older ledger mismatch remains a local maintenance follow-up; it is not a hosted migration result.

## Review and evidence limits

Independent standards and specification reviews identified provenance-forgery, CI-local-port and legacy-fact-display issues; these were corrected and both re-reviews report no remaining material findings. [Review record](2026-09-09-dated-observations-review.md).

Private runtime logs, fictional login credentials, collection fixtures and fingerprints remain in ignored `artifacts/dated-observations/`. They are not published. This local demonstration does not establish live-provider correctness, hosted deployment acceptance or human stakeholder acceptance. The existing background build remains available until the final candidate is verified and switched explicitly.

## Visible comparison

The earlier build screenshots use the same newly prepared fictional records to isolate the display difference. They show the old rendering, not proof that the old collector saved these later records.

- [Before: Automation](dated-observations-2026-09-09/before-automation.png) → [After: desktop date and result](dated-observations-2026-09-09/chromium-dated-result-1-viewport.png).
- [Phone: first result](dated-observations-2026-09-09/mobile-dated-result-1-viewport.png) and [changed result on the same date](dated-observations-2026-09-09/mobile-dated-result-2-viewport.png).
- [Phone: compact review actions](dated-observations-2026-09-09/mobile-dated-result-1.png).
- [Earlier evidence and its retained task link](dated-observations-2026-09-09/chromium-earlier-evidence.png); [legacy evidence with known facts retained](dated-observations-2026-09-09/chromium-legacy-evidence.png).
