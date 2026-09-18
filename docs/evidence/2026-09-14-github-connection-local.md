# Phase 5 local connection-cycle proof (fictional, 18 September 2026)

Two finite `github:reconcile-connections` executions ran against a disposable
local Supabase project seeded with one fictional installation
(`Fictional-Co`, provider id 79901), one selected repository and one queued
`installation` webhook delivery. GitHub credentials were fictional
(self-generated JWT key, unreachable App identity), so no real provider,
account, or secret was involved.

- Run 1, exit 0: `webhookDeliveriesClaimed=1 installationsClaimed=1
  ownershipLost=1`. The delivery reached `processed`; the installation claim
  opened exactly one reconciliation run; the provider step failed safely
  against fictional credentials and was isolated without aborting the cycle.
- Run 2, exit 0: `webhookDeliveriesClaimed=0 installationsClaimed=0`.
  Nothing was reclaimed or duplicated: one processed delivery and one open
  run remained.

This proves local drain/claim/isolate/finalise behavior with fictional data.
It is not live-provider proof (no real GitHub App exists yet), AWS proof,
or human acceptance. Those arrive in Phase 9 with the company administrators.
