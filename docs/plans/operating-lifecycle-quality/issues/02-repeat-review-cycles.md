# 02: Recurring work survives the next cycle

**What to build:** Recurring work survives the next cycle as specified in the [programme specification](../../../superpowers/specs/2026-09-09-operating-lifecycle-quality.md).

**Blocked by:** None

**Status:** verified locally

- [x] Later scheduled policy review creates exactly one task and retains old completed history.
- [x] Same-cycle retry creates no duplicate.
- [x] Done → reopen → Done on a recurring source creates only one successor.
- [x] Existing authority and transactional failure guarantees pass local database tests.

Evidence: [local release verification](../../../evidence/2026-09-09-operating-lifecycle-quality.md). External/provider and historical-data limitations remain explicit there.
