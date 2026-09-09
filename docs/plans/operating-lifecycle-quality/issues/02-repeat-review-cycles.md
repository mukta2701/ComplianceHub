# 02: Recurring work survives the next cycle

**What to build:** Recurring work survives the next cycle as specified in the [programme specification](../../../superpowers/specs/2026-09-09-operating-lifecycle-quality.md).

**Blocked by:** None

**Status:** ready-for-agent

- [ ] Later scheduled policy review creates exactly one task and retains old completed history.
- [ ] Same-cycle retry creates no duplicate.
- [ ] Done → reopen → Done on a recurring source creates only one successor.
- [ ] Existing authority and transactional failure guarantees pass local database tests.
