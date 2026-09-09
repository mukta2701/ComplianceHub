# 10: Preserve dated generic collector observations

**What to build:** Let the coordinator review later generic collection results as separate dated evidence and Automation drafts, while identical retries reuse their records and earlier history stays intact. [Specification](../../../superpowers/specs/2026-09-09-dated-collector-observations.md).

**Blocked by:** None outstanding. Collection failure visibility in ticket05 is already verified locally. Independent of the asset-owner import increment; the current implementation batch finishes before this one begins to keep local verification sequential.

**Status:** verified locally; final source synchronisation and background switch pending

- [x] Later-day unchanged facts, later-day changed facts and same-day changed facts produce distinct dated observations; identical retries do not duplicate them.
- [x] Explicit observation identity preserves the original resource reference and is shared by generic evidence and Automation persistence.
- [x] Schema constraints permit keyed observations alongside unchanged unkeyed legacy rows. Legacy IDs, facts, dates, links and review decisions remain intact; unknown historical identity is not invented.
- [x] Each new Automation observation has its own signal, draft and exact source link. Existing decisions and evidence links remain untouched; no review, closure or provider verification is implied.
- [x] Real database concurrency and partial-failure recovery converge on one complete chain per observation, preserving truthful collection health and existing tenant/lifecycle restrictions.
- [x] Scheduled and manual entry points retain their existing write scopes; manual evidence and the independent official GitHub pipeline retain their behavior.
- [x] Existing app views distinguish dated observations and legacy limitations; fictional desktop/mobile demonstration preserves an earlier reviewed record and its links.
- [ ] Relevant automated checks, isolated database tests and independent standards/specification reviews pass; source is committed/pushed and the verified local preview/evidence are updated through the standing project workflow.

Preparation reference: `4fe6d87`. Implementation starting commit: `398e01d`. This is one complete collection-to-review increment, not a separate schema-only delivery.

Fresh verification and review: [change evidence](../../../evidence/2026-09-09-dated-observations.md).
