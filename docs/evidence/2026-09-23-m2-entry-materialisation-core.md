# Milestone 2 entry-level result core: local evidence

This is a Phase 2 Task 3 checkpoint, not Milestone 2 acceptance. The source is on the isolated `codex/m2-monitoring-design` branch. No pull request was merged and no AWS dev release was made.

## What the local tests show

- A complete 15-check run creates official records only for checks with an exact approved mapping. Rejected and pending checks remain technical observations.
- An unchanged entry in a newer selected pack can use its exact earlier approval. A changed entry needs a new Owner decision. A later approval adds only the newly eligible result; a duplicate replay adds nothing.
- A run with no approved entries makes no official records. Failed or rate-limited collections make no official records, including after an earlier valid run created an approval receipt.
- The new result route keeps historical whole-pack records intact on replay. It does not reopen a Finding when an older Failure arrives after a newer Pass. A run approved by two Owners records the approval at each entry instead of naming one Owner for the whole run.
- The old result route rejects a newer explicit rejection, but it still has an older late-result weakness and remains service-callable. This blocks deployment.

## Environment and checks

The database tests used the disposable local Supabase project `compliancehub-m2-isolated` on PostgreSQL port `55432`. Its source migrations were reapplied without seed data. This is separate from the preserved local application database and the AWS dev database. The tests use fictional fixtures; they do not prove a live GitHub provider result.

Fresh lead-run checks on 23 September 2026:

| Check | Result |
|---|---|
| Full app test suite, guarded, one worker | 3,176 passed; 3 skipped; exit 0 |
| New entry-result database contract `115` | 45/45; exit 0 |
| Historical materialisation database contract `070` | 179/179; exit 0 |
| Official-result database contract `072` | 78/78; exit 0 |
| Type checking | Exit 0 |
| Full ESLint run | Exit 0 |

A fresh independent code review found an older Failure arriving after a newer Pass and a run-level audit that named the wrong Owner. The implementer wrote failing tests, fixed both, and the reviewer rechecked the changed code. The reviewer also found that the service can still call the old result route. No local test or source review closes that release blocker.

## Still required before Phase 2 ends

Secure and test the old callable route. Finish Member-safe official reads and result currentness, job wake and finalisation, and the Owner/Admin/Member Monitoring journey. Demonstrate that journey in a local browser before requesting approval for any AWS dev deployment. Milestone 1 acceptance remains a separate gate for the hosted pilot.
