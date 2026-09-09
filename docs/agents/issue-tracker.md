# Issue tracker: existing local documentation

The project tracks feature history and follow-ups in `docs/feature-backlog.md` and `docs/feature-backlog.csv`; GitHub Issues had no existing issues at setup. Keep this arrangement rather than introducing a second external tracker.

- Product specifications: `docs/superpowers/specs/`.
- Implementation programmes and per-increment tickets: `docs/plans/<programme>/`, with one numbered Markdown file per ticket under `issues/` when a programme needs multiple tickets.
- Each ticket names its user-visible outcome, acceptance criteria and actual blockers. Ticket progress is local to that increment; `docs/release-checklist.md` is the sole overall project status source.
- Link new programme work from the existing feature backlog instead of replacing historical entries. Reuse the CSV's existing columns if adding catalogue entries.
- When a skill says publish/fetch tickets, write/read these version-controlled local documents. Do not create GitHub issues, new tracker labels or external messages automatically.
- Record the starting commit with each programme for standards and specification review. Do not ask the owner to rediscover that technical fact.
- No triage-label setup is needed: the triage skill is not installed.
