# 06: Dashboard data availability

**What to build:** Stop failed reads from presenting an apparently empty or complete dashboard; recover through the existing retry experience. [Specification](../../../superpowers/specs/2026-09-09-unavailable-dashboard-data.md).

**Blocked by:** None

**Status:** verified locally

- [x] Required data, count and configuration failures are rejected before metrics render.
- [x] Successful empty results and absent optional configuration remain usable.
- [x] Meaningful regression checks, local desktop/mobile failure and recovery, and independent reviews pass.

Starting commit: `63dd7ab`.

Evidence: [local verification and screenshots](../../../evidence/2026-09-09-data-availability.md). Hosted/provider acceptance remains separate.
