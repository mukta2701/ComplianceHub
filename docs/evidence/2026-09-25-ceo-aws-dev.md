# AWS dev release: clearer Connections, Settings and policy feedback

25 September 2026. This is release evidence for the AWS **dev** service, not production or final human acceptance.

## What was released

- Source `90be6a5048f165d727548938cff04c26b74193b5` on `codex/ceo-readiness-polish`.
- The one pending additive database migration, `20260925021506_policy_feedback_decisions.sql`, was confirmed by a linked dry run, applied, then confirmed in remote migration history.
- [CI run 36091543105](https://github.com/mukta2701/ComplianceHub/actions/runs/36091543105) passed application, database, container, secrets and changes jobs for that exact source.
- [AWS dev deployment run 36092496372](https://github.com/mukta2701/ComplianceHub/actions/runs/36092496372) succeeded for that exact source. The optional GitHub reconciliation jobs were intentionally skipped; this release did not perform the Aman-controlled App access or Slack alert rehearsal.

## Fresh hosted checks

- `https://jyfq6gjcbz.eu-west-2.awsapprunner.com/api/health/live` returned `status: ok` and release SHA `90be6a5048f165d727548938cff04c26b74193b5`.
- `/api/health` returned `status: ok`, `db: ok` and the same release SHA.
- In an existing signed-in Owner session, `/app/integrations` rendered the GitHub repository access card first, Slack private-channel setup next, and optional GitHub Issues/Jira trackers below. It showed the existing selected pilot repository and a *Configured* Slack destination, without implying a fresh Slack delivery test.
- `/app/settings#team` rendered the Owner-only member list and invite controls. `/app/monitoring` rendered the existing GitHub pilot findings and a most recent saved observation dated 24 September 2026, 23:37. `/app/policies` rendered the existing policy library without a page error.
- No hosted invitation, policy approval, policy-feedback submission, team invite, GitHub reconciliation or Slack alert was initiated during this release verification.
- A read-only Owner-session route sweep loaded the main content without a page-level error on Dashboard, Tasks, Risk register, Evidence, Gap assessment, Controls & applicability, Policies, Asset inventory, Monitoring, Automation inbox, Internal audits, Performance, Leadership report and Settings. Connections also loaded but showed the assistant-panel error below. This is a page-load smoke check, not a write-path or role-permission test of every feature.

## Visual and behavioral limits

The [local desktop/mobile before-and-after evidence](2026-09-25-ceo-ui/README.md) uses an isolated fictional workspace. Its Owner/Member policy-feedback and matching-email invitation journeys passed locally, but this is not a live-provider or hosted Member rehearsal. The real hosted workspace currently has one policy *In review* and no approved policy, so Member feedback cannot be exercised there without changing real policy state.

The hosted Connections page repeatedly displayed **“Connected assistants are temporarily unavailable”** in the existing OAuth grant-list panel. This is an unresolved read error and must not be reported as a working assistant connection. The GitHub connection card says its last connection check was 23 September, while Monitoring has a newer saved repository observation; the two dates refer to different checks and should not be conflated.

An unauthenticated read of both linked Supabase OAuth discovery URL forms returned HTTP 404. [Supabase documents](https://supabase.com/docs/reference/javascript/oauth-server-listgrants) `listGrants()` as relevant only when its OAuth 2.1 server is enabled. This makes disabled OAuth a plausible cause of the assistant-panel error, **not** a confirmed diagnosis of the signed-in API response. Enabling OAuth would be a separate security-sensitive configuration decision, not part of this UI release.

Milestone 1 still needs the controlled post-recovery new-incident/Slack alert proof, Admin/Member live role rehearsal, default-branch unattended schedule proof, and Owner acceptance. None of those is supplied by this UI release.
