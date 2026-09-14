# 07: Audit metric availability

**What to build:** Display unavailable findings counts honestly while keeping a successfully loaded audit register usable. [Specification](../../../superpowers/specs/2026-09-09-unavailable-dashboard-data.md).

**Blocked by:** None

**Status:** verified locally

- [x] Findings failure displays unavailable metrics with a clear explanation, retaining audit rows and known audit count.
- [x] Successful empty findings still display zero; normal counts and preflight behavior remain correct.
- [x] Regression checks, local desktop/mobile failure and recovery, and independent reviews pass.

Starting commit: `63dd7ab`.

Evidence: [local verification and screenshots](../../../evidence/2026-09-09-data-availability.md). Hosted/provider acceptance remains separate.
