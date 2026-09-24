# Monitoring clarity design

Approved by the owner on 24 September 2026 for local review before any AWS deployment.

## User-visible outcome

Monitoring should tell a CISO or non-technical colleague whether GitHub results are current, which saved findings need attention, where to act, and when GitHub was last checked. The existing ComplianceHub visual language stays in place. No check, mapping approval, evidence, finding, or recovery action is deleted.

## Information order

1. Show the GitHub connection and repository health, including the last check and a recheck action where the role permits it.
2. Summarise saved results. If any result is past its `freshUntil` time, explicitly label it as an older result that needs a new check. Counts of old passes or failures must not sound current.
3. Show open findings with a plain explanation, recommended action, repository, observation date, task and review controls. Do not call an older finding a current violation.
4. Keep audit information available in disclosures. The check catalogue and per-result history remain available, but internal IDs, rule versions, mapping versions, and checksums are nested below plain-language information.

## Status language

- A fresh pass may say `Passed at last check`.
- An expired pass says `Previously passed; needs recheck`.
- An expired failure says `Previous issue; needs recheck`. It remains an open finding until a newer passing check resolves it.
- An unknown check never becomes a pass. It says `Could not verify`, with an out-of-date qualifier when applicable.
- An expired result is not represented as a current compliance result or ISO certification.

## Boundaries

This changes presentation only. Repository scope, collection schedules, mapping approvals, access controls, provider calls, evidence retention, and finding lifecycle do not change. Owner-only actions remain Owner-only. Audit details remain accessible to existing authorised roles. Test both current and expired results and compare the local page with the existing AWS screenshot before requesting deployment approval.
