# Repeat GitHub App alert rehearsal on AWS dev

On 23 September 2026 BST, the owner approved a repeat of the single-installation suspension and recovery test to check the new private Slack alert text and Connections link. Aman performed both GitHub App actions. ComplianceHub did not change repository selection or permissions.

## Observed result

- [Protected AWS dev run 35797481755](https://github.com/mukta2701/ComplianceHub/actions/runs/35797481755) deployed source `3d6de059f3f8d84146b37f2af6050bf4d6c01e45`, a documentation-only successor to the alert-link source. The initial two image-bound checks passed while the installation was healthy. Fresh `/api/health` after recovery reported the same release and `status: ok`, `db: ok`.
- Aman confirmed that he suspended only the `ComplianceHub Dev` installation on AdTecher at 00:42:40 BST. One genuine `installation.suspend` webhook reached the app. The first bound reconciliation claimed one webhook and one installation and recorded `actionRequired=1`; the second claimed no webhook and recorded no second incident. The authenticated Connections page showed Owner action required and retained the one selected pilot repository.
- Neither pass claimed a Slack delivery. The private `#cyber` channel received no new message, and the Owner's unread notification count did not rise. We therefore did **not** verify the new Slack text or clickable link in a live message.
- After a separate restore instruction, Aman restored the same installation at 00:46:29 BST and confirmed unchanged scope and permissions. The recovery pass claimed one webhook, recorded `recovered=1` and no Slack delivery. A second pass recorded one healthy installation and no new webhook work. The authenticated Connections page returned to Healthy. A read-only database check found one healthy installation and zero open connection incidents.

## Cause of the missing repeat alert

The linked AWS dev database uses UTC; `current_date` was still 22 September during the 00:42 BST test. Its two delivered GitHub connection alerts, from the first rehearsal at 21:24 and 21:28 UTC, also have `delivery_on = 2026-09-22`. `queue_github_connection_alert_delivery` hashes the installation, alert kind and diagnostic into its idempotency key and allows one row for that key per `delivery_on`. The fresh incident opened at 23:43 UTC and resolved at 23:47 UTC, but the database inserted no new delivery rows. Owner notifications use a matching once-per-UTC-day conflict key. This is why the App state and incident lifecycle worked while new Slack and in-app notices did not appear. It is an existing deduplication rule, not evidence that the webhook or Slack connection failed.

The next decision is whether a recovered connection that fails again on the same UTC day should alert again. If yes, deduplicate by incident lifecycle rather than by UTC date, then test a fresh real event. The new link remains live-unverified until such a test succeeds. No alert-policy code or database schema was changed in this diagnosis.
