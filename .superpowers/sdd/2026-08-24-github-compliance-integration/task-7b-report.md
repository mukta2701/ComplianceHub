# Task 7B report — GitHub compliance control-room UI

## Outcome

Phase 5B delivers the bounded integrations-page slice of the reviewed Phase 5A control room. Workspace Owners can review the immutable standard mapping, explicitly accept its limitations, approve or revoke the exact published version/checksum, process one exact approved run, and recover one exact exhausted job with a closed reason code. Admins and Members receive the same safe GitHub status, mapping, and official-result view without mutation controls.

This does not complete plan Task 4 or Phase 5. Phase 5C remains mandatory for exact Evidence/Monitoring record navigation and desktop/Pixel/Axe browser proof. The Owner-claim fix round adds one additive database migration without changing the claim signature or repository reconciliation behavior; it changes no collector, materialiser transaction, evidence/finding lifecycle, readiness/SoA/assessment/risk state, MCP/digest, Slack logic, provider transport, or hosted resource.

## User experience

- The screen explains the workflow as four separate steps: Connect, Select, Review, Process. Repository selection remains visibly separate from mapping approval.
- The mapping review shows the exact published version, full checksum, publication time, all fifteen check IDs, ISO references, all four outcome treatments, severities, remediation guidance, limitations, and identity-free approval history.
- Approval requires an explicit Owner checkbox acknowledging that technical signals do not certify ISO compliance or change readiness by themselves.
- A different historical active mapping is not labelled as approval of the reviewed pack. It must be revoked before the current reviewed version can be approved.
- Repository cards use only the approved vocabulary: `Needs attention`, `Awaiting approval`, `Shadow`, `Official records stale`, and `Official records current`.
- The bounded exhausted-job queue is rendered independently of the current repository page, with closed Owner recovery choices, total/truncated disclosure, and iterative access to later queued jobs. Repository results have Previous/Next navigation backed by the control-room RPC offset.
- Result counts use `verified technical pass`, `verified issue`, `could not verify`, and `not applicable`. The UI does not describe a repository as compliant, certified, or secure, and does not claim readiness improved.
- Only the already validated canonical GitHub repository URL is rendered. Evidence/finding links are explicitly interim list navigation with check-specific accessible names; Phase 5C must replace them with exact record navigation. Result rows show validated rule and mapping versions. Raw provider fields and actor identities are absent.
- Recovery exposes only `configuration_corrected`, `provider_recovered`, and `owner_reviewed`; there is no arbitrary reason field.
- Semantic headings, lists, fieldsets/legends, labels, a single polite live region, text-plus-colour status, visible focus, bounded long values, and single-column mobile fallbacks are included.

## Security and data boundaries

- GitHub App setup, OAuth callback completion, repository scope changes, and manual rechecks are exact Owner-only boundaries. Generic Jira and other integration-management capability remains unchanged.
- The service-only installation claim now also requires and row-locks the exact active workspace Owner before any installation/repository mutation, then revalidates that exact Owner after the installation lock. Admin, Member, outsider, and cross-workspace roles cannot claim through the server boundary.
- Every new action authenticates and checks Owner role before data or service access, validates strict closed-world UUID/form input, preflights the exact active organisation through the authenticated RLS client, applies a per-organisation/per-user limit, and only then constructs or passes a service client.
- Approval is pinned to the compiled standard version/checksum and an exact published database row. Revocation is pinned to one active approval in the current organisation. Processing is pinned to one terminal run plus its exact repository/job and exact active approval. Retry is pinned to one exhausted exact job plus a closed reason code.
- Service/database/provider detail is mapped to stable user messages. Successful actions revalidate only `/app/integrations`.
- The mapping loader selects bounded columns only, validates an exact published pack and exactly fifteen entries against the canonical checksum semantics, and loads at most twenty organisation-scoped approval-history rows without actor IDs.
- The repository state classifier gives attention conditions first, then missing approval, then shadow, then stale/current. Current requires the exact active pack ID/version/checksum, exactly fifteen unique expected checks, a completed latest job, and every result strictly fresh at the shared database `asOf` time.

## TDD evidence

RED was recorded before each production seam:

- the absent state classifier and mapping-review loader failed module resolution;
- the absent dedicated GitHub actions failed module resolution;
- setup/callback Admin tests reached the old operator-capability path;
- Admin manual recheck reached installation lookup;
- the absent control-room component failed module resolution;
- page role tests did not receive the safe control-room view;
- the installation note still said Owners/Admins;
- a historical active mapping was incorrectly labelled `Owner approved`.

Focused GREEN after the main implementation was nine files / 135 tests. The later exact historical-mapping and full action-role matrix also passed in focused runs. The final post-review full count is recorded after the independent review closes.

## Verification

- Full lint: passed.
- Final full Vitest after the Owner-claim fix: 219 files / 1,723 tests passed.
- TypeScript typecheck: passed.
- Focused ESLint and `git diff --check`: passed.
- Actionlint: passed.
- The privacy hook scanned every staged code/workflow file and blocked on four unchanged Slack reference-name assertions (`SLACK_ALLOWED_WEBHOOK_SHA256`) in the shared workflow/contract. They contain no destination, webhook, hash, credential, or PII; this fix changes only the migration attestation in those files. No ignore rule or scanner weakening was added.
- Production build reached the unchanged `next/font/google` boundary and failed only because this network-restricted environment could not fetch Geist and Geist Mono from `fonts.googleapis.com`.
- Focused pgTAP `076` could not connect because the sandbox cannot access the Colima Docker socket; the Supabase CLI reported `LegacyDbConnectError`. No database execution is claimed.
- Playwright is intentionally deferred to the following Phase 5C/6 runtime proof; this phase was explicitly scoped to unit/component/page verification.

## Scope and acceptance

No GitHub, Slack, Supabase-hosted, Azure, or other external call/write occurred. No Slack file or behavior changed. The new successor migration was generated locally through the pinned Supabase CLI and was not applied to any hosted database. Local pgTAP execution remains a mandatory release gate because this worktree cannot connect to PostgreSQL. A production/network-enabled build and Phase 5C browser/runtime acceptance remain separate gates. This report describes the integrations control-room slice only; it does not claim Task 4 or Phase 5 complete.

## Owner-claim fix round

- Repository selection now rate-limits the exact active organisation/user only after strict parsing and authenticated Owner/RLS preflight, and before the authenticated selection RPC. It never constructs a service client.
- Suspended, missing-permission, and not-found manual recheck tests now use an Owner and prove installation lookup occurs while provider, limiter, materialiser, or service work remains untouched where required.
- Generated successor migration `20260825094343_owner_only_github_installation_claim.sql` preserves the reviewed service-only signature, validation, canonical inventory, installation ownership, repository reconciliation, and grants. It narrows the actor to an exact Owner and locks/revalidates that membership around the installation lock.
- New pgTAP `076` covers Owner, Admin, Member, outsider, cross-workspace membership, privileges, and a legal two-session Owner-to-Admin demotion race. It is authored but cannot execute until a local database is available.
- Deployment attestation now documents twenty-two ordered migrations through `20260825094343`; the required bridge remains `20260825040825`, and Slack runtime behavior is unchanged.

## Independent review and authority ruling

The first independent review found no Critical issue and five Important items. Four were corrected test-first: render the bounded exhausted queue and repository pagination, show mapping-pack approval/revocation lineage, align no-collection and exact-active-pack UI state, and restore the authorized-Owner strict payload test. Re-review then found the missing rule/mapping version presentation; a focused test failed RED and the validated versions now render on every result row.

The remaining concurrency question was accepted by the controller as an explicit architecture ruling, not silently dismissed. Task 3 materialisation is authorized by the durable active immutable Owner approval and deliberately runs without a current human actor from scheduled, webhook, daily, and manual prompt paths. The manual button adds prompt timing, not additional data or transition authority. Its action still requires exact active-org Owner context, strict target validation, the exact active reviewed mapping, and rate limiting before business service-client construction. A demotion after that boundary is equivalent to already-authorized automatic processing. This phase does not claim linearizable current-Owner authorization and does not add a misleading actor lock or migration.

Final independent re-review approved the current snapshot with no remaining Critical or Important finding. Its independent focused run passed five files / 98 tests, plus typecheck, touched-file ESLint, and `git diff --check`.

The Owner-claim fix-round independent review also approved with no Critical or Important finding. A direct original/successor comparison confirmed that signature, validation, inventory, advisory/conflict handling, JWT context, installation/repository mutation and reconciliation, grants, and return behavior are preserved. The reviewer found the two-session demotion fixture structurally valid and independently passed three files / 73 tests, typecheck, touched-file ESLint, Actionlint, staged diff checks, and a zero-finding security diff scan. Runtime pgTAP remains open solely because PostgreSQL is unavailable.
