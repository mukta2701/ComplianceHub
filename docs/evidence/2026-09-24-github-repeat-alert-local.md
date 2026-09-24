# GitHub repeat-alert local check, 24 September 2026

## What changed

The owner chose one private Slack-channel alert for each new GitHub connection incident after verified recovery, even if both incidents occur on the same UTC day. The migration uses the recorded incident ID for its queue key. It keeps repeat checks of one incident quiet and leaves existing delivered or failed alerts, attempt counts and retry times intact. Owner and Admin in-app notices also use the incident ID; Members receive none.

## Fresh local evidence

The migration applied to `m1_repeat_verify`, a disposable database cloned from the local Supabase schema. It did not change the app preview database or AWS dev. Before the migration, the new same-day regression failed on the second incident and recovery. After the migration, these database suites passed with no `not ok` results:

| Suite | Passed assertions |
| --- | ---: |
| `104_github_connection_alerts.sql` | 24 |
| `105_github_connection_alert_delivery_worker.sql` | 27 |
| `106_github_connection_notice_projection.sql` | 23 |
| `107_github_connection_lifecycle_regressions.sql` | 35 |
| `108_github_connection_repeat_incident_same_day.sql` | 55 |

The new suite covers two failure-and-recovery cycles on one day, repeated checks, retries across midnight, mixed diagnostics, old delivered and failed rows, backoff preservation, service-only function access, and Owner/Admin versus Member notices. A fresh independent code review found no remaining material issue. Its static review did not test live Slack delivery. The timestamp-tie check covers diagnostics closed together, not two separate incident cycles with identical timestamps.

## Not yet proven

No one has applied this migration to AWS dev or seen a new Slack message and its link from the repaired flow. The default-branch hourly schedule, Admin/Member hosted rehearsal and human acceptance remain open. The live AWS dev release is still `3d6de05`.
