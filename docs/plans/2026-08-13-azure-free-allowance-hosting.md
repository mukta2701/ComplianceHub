# ComplianceHub Azure free-allowance hosting design

## Decision

Host the staging web application and Streamable HTTP `/mcp` endpoint on Azure
Container Apps using the Consumption plan. The app scales from zero to one
replica and keeps Supabase as the source of truth. Render, AWS, Azure Container
Registry, production rollout, Claude testing, and team-channel Slack delivery
remain outside this stage.

## Runtime architecture

GitHub Actions verifies the application, builds the Node.js 22 standalone Next.js
image, publishes an immutable image to the public GitHub Container Registry, and
deploys that digest to a UK South Container App. The runtime uses 0.5 vCPU and
1 GiB memory, HTTPS-only external ingress, single-revision traffic, and explicit
startup, liveness, and Supabase-aware readiness probes. Azure retains five
inactive revisions; single-revision mode keeps traffic on the previous healthy
revision when a replacement cannot become ready.

The foundation deployment creates the staging resource group, bounded Log
Analytics workspace, Consumption Container Apps environment, bootstrap app, and
a one-unit monthly budget in the subscription's billing currency. Logging is
retained for 30 days and capped at 0.1 GB per day. Budget notifications fire at
50%, 80%, and 100%. Alerts are warnings rather than a hard spending cap.

## Configuration and trust boundaries

Public Supabase and site values are supplied both to the image build and runtime.
The service-role key, application encryption key, and cron secret are secure
Bicep parameters backed by GitHub environment secrets and become Container Apps
secret references. They never enter the public image. GitHub authenticates to
Azure with OIDC; the resulting principal receives deployment access only to the
staging resource group.

After the bootstrap hostname is known, it becomes `NEXT_PUBLIC_SITE_URL` and its
exact `/mcp` path becomes `MCP_RESOURCE_URL`. Supabase Auth receives the matching
redirect allowlist and OAuth resource audience. The existing RLS, membership
roles, encrypted Slack webhook, private digest channel, and audit trail remain
unchanged.

## Scheduling and rollout

GitHub Actions replaces the unused Vercel schedules by invoking the authenticated
daily and monitoring routes at 06:00 and 07:00 UTC. The daily Slack digest stays
a separate hosted Codex task at 09:00 Europe/London. The deployment is first run
manually from `codex/internal-mcp-digest`; automatic `main` deployments begin only
after the feature pull request is accepted.

Acceptance requires a clean repository verification, a non-root container,
successful health checks, OAuth and MCP client tests, digest shadow comparison,
and three posts to the private Slack test channel. Ten business days of staging
dogfooding precede any production or team-channel decision.
