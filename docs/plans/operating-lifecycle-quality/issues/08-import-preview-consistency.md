# 08: Confirm the previewed import

**What to build:** Require a fresh preview after settings change and keep pending inputs stable. [Specification](../../../superpowers/specs/2026-09-09-import-preview-consistency.md).

**Blocked by:** None; independent of the pending asset-owner semantics decision.

**Status:** verified locally, committed/pushed and running in the background preview

- [x] Mapping/register changes invalidate confirmation; a fresh preview restores it.
- [x] Pending inputs cannot change; confirmation consumes its preview.
- [x] Regression checks, local desktop/mobile upload→map→preview→confirm demonstration and independent reviews pass.

Starting commit: `068384e`.

[Fresh evidence and limitations](../../../evidence/2026-09-09-import-preview.md).
