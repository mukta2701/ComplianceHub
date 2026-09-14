# 05: Make failed collection visible

**What to build:** When generic collection fails, or evidence is saved but its Automation proposal cannot be saved, report a failed/partial outcome and show the linked connection needs attention. Preserve the previous success date. A successful later complete collection can clear that error. This does not repair observation identity, which awaits a separate data-model decision.

**Blocked by:** None.

**Status:** verified locally

- [x] Provider/evidence/provenance failure increments source failure once and does not stop other sources.
- [x] Failure stores only safe failure time/state for the valid same-workspace linked connection and preserves last success.
- [x] Successful health update happens after all source items/persistence complete; empty result may count as a completed collection.
- [x] Paused/revoked connections are not resumed or overwritten by failure/recovery, including concurrent status change.
- [x] Existing completed evidence/proposal history is preserved; no provider calls in local tests.
- [x] Reproduction uses the existing collector interface and database boundaries; relevant permission/tenant health checks and current Automation presentation are verified.

Evidence: [local release verification](../../../evidence/2026-09-09-operating-lifecycle-quality.md). External/provider and historical-data limitations remain explicit there.
