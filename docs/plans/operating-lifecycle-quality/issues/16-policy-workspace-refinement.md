# 16: Policy workspace refinement

**Starting commit:** `d938edf6461701155dafb7aff776b6bf6ece9b19`

**What to build:** A coherent Policy library → author/edit → approve → employee acceptance → connected review context journey, as described in the [policy workspace specification](../../../superpowers/specs/2026-09-10-policy-workspace-refinement.md). Preserve current lifecycle and role boundaries while correcting misleading reads, stale metadata saves and acceptance of unseen content revisions.

**Blocked by:** None.

**Status:** ready-for-agent

- [x] Inspect current source, policy lifecycle, permission rules, historical decisions and existing test seams; distinguish implemented capabilities from defects and deferred additions.
- [x] Record the bounded specification, measurable acceptance criteria and immutable starting commit in the existing documentation conventions.
- [ ] Library and document detail present equivalent desktop/mobile context with clear ownership, state, content version, review dates and role-appropriate acceptance information.
- [ ] Library counts and acceptance figures cover their stated population beyond one database page; capped displays are explicit and failed reads remain unavailable instead of becoming empty, default, unassigned or missing states.
- [ ] Structured author/edit forms preserve templates, all fields and explicit ownership, retain drafts after failures, prevent duplicate pending submissions and provide associated errors and safe return navigation. Template changes do not silently discard unfinished work.
- [ ] Technical compare-and-set protection rejects stale metadata/content saves and detects relevant status/assignment changes. Original tokens remain paired with drafts; confirmed saves advance the token safely, including notification-warning cases.
- [ ] Approval/status actions confirm an authorised affected row and reject stale decisions. Owner/Admin authority and ordinary Member denial remain intact without introducing new approval roles or transition rules.
- [ ] Database acceptance atomically checks the displayed content version and current approved state. Stale or withdrawn-policy attempts record no new acceptance; identity, workspace and timestamps remain server-derived and only trusted acceptances count.
- [ ] Material body edits increment the content version exactly once and require re-acceptance; non-material edits do neither. A committed save and failed notification remain distinct, and mandatory reapproval is not introduced.
- [ ] Operator evidence navigation/freshness and existing review-task context connect to permitted source records; link/unlink and library/detail refresh work. Members retain their current read-only context without blocked Evidence navigation or colleague rosters.
- [ ] Feedback discussion, version attribution, historical resolution and approved-policy collaboration remain usable and distinct from policy editing, approval and employee acceptance.
- [ ] Fictional local production-browser acceptance demonstrates operator author/edit/approve, employee acceptance/re-acceptance, stale-edit/stale-acceptance rejection and connected evidence/review work. Desktop/tablet/mobile and keyboard/accessibility evidence cover library, detail and forms.
- [ ] Relevant focused/full, integration/database and existing review-automation checks pass. Independent standards/specification reviews have no material unresolved findings; verification levels and limits are recorded accurately.
- [ ] Verified source and sanitised evidence are committed and pushed; the local app runs the verified build and the existing release checklist reflects demonstrated facts.

Only planning is complete at ticket creation. Rich-text editing, revision archives, e-signatures, new approval rules, policy-control mappings, private feedback notifications, expanded Member evidence access and automatic review renewal remain deferred.
