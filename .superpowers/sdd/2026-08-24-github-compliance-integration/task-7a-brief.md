# Task 7A brief — GitHub compliance control-room prerequisites

Phase 5A supplies trustworthy seams for the later visual control room; it does not claim hosted acceptance or add a recovery button.

- Member reads use one bounded, statement-consistent, security-invoker RPC. It returns only approved compliance state, trusted repository labels/URLs, truthful pagination, and bounded exhausted attention.
- Repository selection is an Owner-only human decision. The database locks the exact authenticated membership row through mutation; the action and checkbox match that rule. Admins retain other connection capabilities, and Members see only a safe read-only GitHub state.
- Exhausted-job retry remains service-only and exact-once. The application and database accept only `configuration_corrected`, `provider_recovered`, or `owner_reviewed`; immutable audit metadata stores only the code and previous attempt count.
- Successor migration `20260825082411_harden_github_control_room_ownership_privacy_indexes.sql` adds the exact partial indexes used by exhausted attention and selected-repository pagination. It does not edit the earlier control-room or Slack migrations.
- Final deployment attestation is twenty-one ordered migrations through `20260825082411`; bridge remains pinned to `20260825040825`.

Static verification is green. Local database/two-session/representative EXPLAIN evidence remains blocked by unavailable Docker/Postgres; disposable integration credentials are absent; production build is blocked by the unchanged network-fetched Google Fonts. These are recorded gates, not bypassed checks. No external provider, hosted database, Azure, or Slack write occurred.
