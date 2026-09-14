# Dated observations: independent review

Starting commit: `398e01d`. Reviewed the complete working-tree diff and new migration/tests against the dated-observation specification, repository guidance and Matt Pocock's code-review skill. Reviewers did not author the implementation they reviewed.

## Standards — Sol

Initial findings:

1. High: table-wide evidence INSERT allowed authenticated callers to fabricate collector metadata. Resolved with an invoker trigger using the database role, reserving source/reference/observation fields for trusted writes. Existing manual-evidence role restrictions remain unchanged; database regressions include spoofed claims and partial provenance.
2. High: the integration harness accepted only the isolated local port, excluding the canonical CI stack. Resolved by accepting only the two supported loopback origins. Optional fictional demo export still requires the isolated stack and an explicit flag.

Fresh static re-review: both resolved; no remaining material standards, security or maintainability findings.

## Specification — Astra

Initial P2: legacy Automation display hid known signal dates and resource references. Resolved by retaining the known recorded date and reference alongside the identity warning. The display does not invent a collection timestamp.

Fresh static re-review: no remaining material specification findings. Recorded result now distinguishes same-day changes. Manual collection write scope and trusted provenance boundaries match the specification. No active non-generic source-object writer was found in this repository; an unconfirmed external writer that intentionally omitted observation metadata would need separate wording consideration.

The reviewer also checked the explicitly gated fictional browser fixture and later provider-type correction; no material findings.

## Runtime follow-through

Root executed the corrected migration rehearsal (51 assertions), full preserved-local database suite (2,218 assertions) and actual local collector integration (2 tests), all passing. Final production browser/visual acceptance is recorded in the linked change evidence after completion.

Final follow-through: production desktop/mobile acceptance2/2 passes after the measured mobile spacing correction. Standards re-review confirms the CSS scope and behavioural regression. Independent Astra visual recheck of the final screenshots reports no material visual/specification findings.
