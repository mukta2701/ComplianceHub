# 09: Import assets with explicit accountable owners

**What to build:** Import location text safely and assign only the explicitly named, uniquely matched workspace member. [Specification](../../../superpowers/specs/2026-09-09-explicit-asset-import-owner.md).

**Blocked by:** None. Owner approved the separate column on 9 September 2026.

**Status:** verified locally; Git/background closeout pending

- [x] Location-only and blank owner imports remain unassigned; explicit unique names assign correctly.
- [x] Ambiguous/unmatched/unavailable owner lookups are flagged and excluded; confirmation rechecks membership.
- [x] Visible import guidance explains the new field and current export limits.
- [x] Action/adapter regressions, local desktop/mobile persistence demonstrations and independent reviews pass.
- [ ] Verified source committed/pushed and installed in the background preview.
