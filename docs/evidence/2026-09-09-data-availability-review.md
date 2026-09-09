# Independent review: dashboard and audit availability

Reviewed the working changes against `63dd7ab611cc81defa88b72958403c5f0b784585`, including the new specification, tickets and error-boundary test. Matt Pocock's code-review skill was applied with independent parallel reviewers. Source reviews are distinct from the runtime evidence in the [verification record](2026-09-09-data-availability.md).

## Standards — Luna

No material standards findings. Reviewed against AGENTS, CLAUDE, CONTEXT, README, domain conventions, installed Next16.3 error-boundary docs and the skill's Fowler smell baseline.

- Dashboard changes preserve tenant filters, limits, calculations and vocabulary.
- Generic errors avoid exposing database details.
- The authenticated error boundary remains a Client Component and uses the documented retry contract.
- Audit unavailable metrics remain distinct from successful zero results.
- The two local dashboard helpers repeat the same small error-throw shape; this was assessed as a non-material duplication judgement call, not a finding requiring abstraction.

No tests or runtime verification were performed by this reviewer.

## Specification — Astra

No specification findings.

- Guards implement the requirement to check existing server-page database results before deriving dashboard values, including work, evidence, configuration and setup counts.
- Audit changes mark dependent metrics unavailable while retaining the loaded audit list; successful empty findings still show zero.
- Retry matches the installed framework contract and the specified fresh-content recovery requirement.
- No implementation scope creep: permissions, tenant filters, calculations, source limits and Member overview remain unchanged. Deferred asset documentation is separated from implementation.

Local candidate browser recovery evidence was still pending at source review time; the review does not substitute for those checks.

Standards:0 material findings. Specification:0 findings.

## Independent visual review — Luna

No material visual findings. Desktop and mobile audit cards clearly pair Unavailable with an explanation and retain known audit information. The dashboard error and actions are readable with visible keyboard focus. Existing horizontally scrolling mobile audit-table content extends beyond the viewport inside its table region; this was unchanged from the before image. Screenshot review does not establish full accessibility. Root separately demonstrated the browser journeys and ran targeted automated accessibility checks.
