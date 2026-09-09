# Preserve dated generic collector observations

Prepared from `4fe6d87` on 9 September 2026. The owner approved keeping dated snapshots after reviewing the repeated-observation decision. Part of the ongoing operating-lifecycle programme; the release checklist remains the overall status source. This specification prepares the next increment and does not declare implementation complete.

## Problem Statement

A later generic collection can report different facts or a later checked date for an already known resource, yet ComplianceHub retains only the first evidence and Automation signal. The coordinator sees a successful collection without the new dated record needed for review. Replacing the first record would destroy the meaning of earlier evidence links and human decisions.

## Solution

Preserve a separate dated observation when the normalized facts or recorded collection date change. Identical retries reuse the same observation. Keep the original resource reference and earlier records intact. Each new Automation observation creates its own draft for authorised review, including when unchanged facts are observed on a later day. The resulting additional records and drafts are an accepted consequence of retaining dated snapshots.

## User Stories

1. As a coordinator, I want later collected facts preserved, so that a successful collection does not hide a changed result.
2. As a reviewer, I want unchanged facts collected on a later day recorded separately, so that I can distinguish earlier and later checks.
3. As a coordinator, I want changed facts collected on the same day preserved separately, so that day-level dates do not discard meaningful changes.
4. As an operator, I want identical retries to reuse their records, so that retrying does not create duplicate evidence or drafts.
5. As a reviewer, I want the resource reference retained beside its observation date, so that I can recognise what was checked.
6. As a reviewer, I want each draft linked to its exact source observation, so that later collection cannot change the basis of my decision.
7. As an accountable contributor, I want previous tasks, evidence links and review decisions preserved, so that collection does not silently rewrite completed work.
8. As a coordinator, I want partially saved observations completed on retry, so that a temporary persistence failure does not lose the new review work.
9. As an operator, I want concurrent collection of the same observation to converge, so that overlapping workers do not duplicate records or report a false failure.
10. As a reviewer, I want legacy observation identity identified as unknown, so that incomplete history is not presented as reconstructed proof.
11. As a workspace member, I want existing workspace access boundaries preserved, so that observation history does not expose another organisation's records.

## Implementation Decisions

- Define an observation at the precision the generic provider contract actually supplies: the recorded collection date in UTC, at day granularity, plus its normalized result. This is not a record of every poll, an exact provider event timestamp or an exact historical query window. Preserve any existing collection limits and source descriptions.
- Derive one versioned deterministic observation key from a fixed-order canonical representation of provider, stable external resource reference, kind, title, note, URL, collection date and validity date. Represent absent optional values consistently. Do not include insertion time, attempt wall-clock time, owner assignment, proposal state or connection health. Identical inputs produce the same key across the generic evidence and Automation persistence paths.
- Keep the original external resource reference unchanged; do not append dates or hashes to it. Add explicit nullable observation identity metadata to generic evidence and Automation source objects. Enforce keyed uniqueness per evidence source/resource/observation and per Automation connection/resource/observation. Keep one signal per source object, one proposal per signal and the existing unique proposal-source relationship.
- Replace the existing lifetime resource uniqueness restrictions with separate constraints for keyed observations and unkeyed legacy records. Existing IDs, facts, dates, links and review states remain untouched. Retain at most one unkeyed legacy row per existing resource identity. Do not backfill invented observation keys or disable evidence immutability to rewrite history. A first keyed observation may coexist with an older unkeyed record; explain this as legacy overlap, not proof of an extra historical collection.
- Keep observation identity stable after insertion while preserving existing permitted status, retention and lifecycle transitions. No new user permissions or broader tenant access are required. Manual evidence and other source-object producers must retain their existing behavior with nullable metadata.
- Scheduled generic collection continues saving evidence and the associated Automation chain. Manual baseline generation and proposal recollection continue their existing Automation-only persistence. All use the same observation definition; this increment does not add evidence writes to manual actions or alter the independent official GitHub pipeline.
- Each newly identified Automation source observation gets its own signal, draft proposal and exact source link. Existing accepted or dismissed proposals remain unchanged. Preserve recorded dates and make them distinguishable in existing evidence/Automation views; identify unkeyed records as legacy observation identity unknown where observation history is presented. Do not imply automatic human acceptance, evidence-link replacement, finding closure or live-provider verification from the existence of a draft.
- Make insertion races recover by reading the winning row using the complete tenant/source/observation identity. Do not treat every unique violation as success. A partial chain must resume from its missing evidence/source/signal/proposal/link without creating duplicates or altering saved decisions. Retain existing truthful per-source failure counting, continued collection of other sources, last-success preservation and paused/revoked connection protections.
- Keep existing public collection counters compatible. A repeated keyed observation may continue contributing to the existing reused/refreshed counter, but visible explanations must not claim that old evidence content or validity was refreshed. New dated observations count as newly saved records in the paths that already save evidence.

## Testing Decisions

Test through the existing collector, manual Automation actions and authenticated read interfaces, supported by focused deterministic identity tests and real isolated-database checks. Reuse the existing collection-health and persistence-recovery seams. Historical reproduction established lost August/September evidence and signals using real application/provider-parsing code with fictional external/database boundaries; it does not establish current database concurrency correctness.

- The same resource with changed facts on a later date yields two preserved records with the correct original facts/dates and two distinct Automation drafts.
- Unchanged facts on a later date and changed facts on the same date each create a new observation. An identical retry creates none. Canonical optional-value handling is deterministic.
- Concurrent identical collection converges to one keyed evidence row where applicable, one source observation, one signal, one proposal and one source link. Verify real unique constraints rather than only an in-memory mock.
- Fail each persistence stage, then retry. The source reports failure truthfully, retains completed writes and previous success, and recovers with exactly one complete chain. Other sources continue.
- Migration checks retain legacy row IDs, facts, timestamps, links and human decisions. Existing legacy uniqueness and new observation uniqueness both hold. Existing evidence immutability, tenant boundaries and user permissions remain effective.
- Verify scheduled collection and both existing manual Automation entry points use the shared identity without changing their write scope. Keep official GitHub regression coverage applicable to its unchanged pipeline.
- Demonstrate fictional dated observations and distinct draft dates in the local production app on desktop and mobile; preserve an older reviewed record and its existing links. Use controlled fictional provider boundaries, not real-provider claims. Keep the ordinary preview available, run heavy checks sequentially under the resource guard, and complete independent standards/specification review before closure.

## Out of Scope

Official GitHub collection/materialisation, every-poll history, new provider adapters or credentials, exact Google query-window reconstruction, automatic acceptance or supersession, automatic task/finding closure, replacing existing evidence links, proposal-volume suppression rules, broad historical backfill, asset import/export, role changes, hosted deployment and external messages.

## Further Notes

The owner selected dated snapshots rather than change-only storage. The approved scope accepts extra dated records and review drafts; it does not establish a retention redesign. Existing retention rules continue to apply. This increment requires an additive schema change and coordinated application rollout because old lifetime lookups cannot interpret multiple keyed observations. Capture the actual implementation starting commit when work begins; `4fe6d87` is the preparation reference, not a claim that unrelated work must be included in its review.

## Review refinements

Collector provenance is written only by trusted collection/database processes. Adding nullable observation metadata must not let an authenticated person fabricate automatic collection records through table-wide INSERT grants. Ordinary manual evidence remains available through its existing roles; source provenance fields are reserved for collector writes. This enforces the existing separation between manual evidence and provider-sourced records.

Show the recorded result alongside its date/resource so changed same-day observations are distinguishable. Legacy identity warnings qualify known historical dates/references rather than hiding them.
