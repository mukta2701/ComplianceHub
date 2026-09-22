# Bounded GitHub App failure and recovery rehearsal — 22 September 2026

## Scope and approval

The owner approved a live rehearsal of the single AdTecher pilot installation in AWS dev. Aman controlled the App administration and performed the suspension and restoration himself. ComplianceHub only received GitHub webhooks and ran its normal connection checks; it did not hold App administrator credentials or change repository access. The existing six read-only permissions and selected repository scope were unchanged. This was a suspension test, **not** a repository-removal test.

The application was still source `799fa7718c1bb09711093167aa938d328438fe22` in AWS dev, with a healthy database. [The protected deployment run](https://github.com/mukta2701/ComplianceHub/actions/runs/35780414073) was rerun against its bound image for each stage. The first reconciliation pass processed new work; the second checked for duplicates.

## Observed sequence

| Stage | Provider and hosted result | Alert result |
| --- | --- | --- |
| Suspend | Aman suspended the pilot App at 21:23:24 UTC. GitHub sent `installation.suspend` with HTTP 202. The first protected pass claimed one webhook and installation and marked one Owner action required; the second still saw the action-required connection without new webhook work. The authenticated Connections page showed Owner action required and prevented a manual GitHub check. | One Owner in-app incident and one HIGH message to the existing private `#cyber` Slack destination. The second pass delivered no duplicate. |
| Restore | After a separate GO, Aman restored the App at 21:27:04 UTC. GitHub sent `installation.unsuspend` with HTTP 202. The first pass claimed one webhook and installation and recorded one recovery; the second saw one healthy installation and no new webhook work. The Connections page returned to Healthy. | One Owner in-app recovery and one MEDIUM Slack recovery. The second pass delivered no duplicate. |
| Redeliver | With approval, Aman redelivered the genuine recovery webhook once at 21:31:19 UTC. Both protected passes succeeded with no new webhook claims, a healthy installation and no Slack work. | No duplicate in-app or Slack notification was observed. |

Aman reported exactly two relevant GitHub audit entries for the pilot App: suspension at 21:23:24 UTC and restoration at 21:27:04 UTC. His separate unrelated PR action was not part of this rehearsal. The audit names “ComplianceHub Dev App” as actor because Aman used its App administration credentials; he confirmed that the ComplianceHub monitoring service did not have those credentials and did not initiate the administration actions.

## Limits and remaining acceptance

This was fresh AWS dev/live-provider proof of a **manual, bounded** suspend/recover/replay journey. It does not demonstrate a repository removal and re-addition, an unattended hourly schedule, a default-branch merge, an approved Admin or Member live session, production behavior, or owner acceptance of Milestone 1. The Slack and in-app messages delivered successfully but included technical diagnostic wording; a separate source change is in review to make them understandable. Until that change is deployed, the hosted alerts retain their original wording.
