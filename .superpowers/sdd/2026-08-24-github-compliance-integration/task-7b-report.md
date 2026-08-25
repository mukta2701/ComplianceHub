# Task 7B report — GitHub compliance control-room UI

## Outcome

Phase 5B turns the reviewed Phase 5A seams into one bounded, presentable integrations control room. Workspace Owners can review the immutable standard mapping, explicitly accept its limitations, approve or revoke the exact published version/checksum, process one exact approved run, and recover one exact exhausted job with a closed reason code. Admins and Members receive the same safe GitHub status, mapping, and official-result view without mutation controls.

This phase changes no database migration, collector, materialiser transaction, evidence/finding lifecycle, readiness/SoA/assessment/risk state, MCP/digest, Slack logic, provider transport, or hosted resource.

## User experience

- The screen explains the workflow as four separate steps: Connect, Select, Review, Process. Repository selection remains visibly separate from mapping approval.
- The mapping review shows the exact published version, full checksum, publication time, all fifteen check IDs, ISO references, all four outcome treatments, severities, remediation guidance, limitations, and identity-free approval history.
- Approval requires an explicit Owner checkbox acknowledging that technical signals do not certify ISO compliance or change readiness by themselves.
- A different historical active mapping is not labelled as approval of the reviewed pack. It must be revoked before the current reviewed version can be approved.
- Repository cards use only the approved vocabulary: `Needs attention`, `Awaiting approval`, `Shadow`, `Official records stale`, and `Official records current`.
- The bounded exhausted-job queue is rendered independently of the current repository page, with closed Owner recovery choices, total/truncated disclosure, and iterative access to later queued jobs. Repository results have Previous/Next navigation backed by the control-room RPC offset.
- Result counts use `verified technical pass`, `verified issue`, `could not verify`, and `not applicable`. The UI does not describe a repository as compliant, certified, or secure, and does not claim readiness improved.
- Only the already validated canonical GitHub repository URL is rendered. Evidence/finding navigation uses fixed internal routes with check-specific accessible names; result rows show validated rule and mapping versions. Raw provider fields and actor identities are absent.
- Recovery exposes only `configuration_corrected`, `provider_recovered`, and `owner_reviewed`; there is no arbitrary reason field.
- Semantic headings, lists, fieldsets/legends, labels, a single polite live region, text-plus-colour status, visible focus, bounded long values, and single-column mobile fallbacks are included.

## Security and data boundaries

- GitHub App setup, OAuth callback completion, repository scope changes, and manual rechecks are exact Owner-only boundaries. Generic Jira and other integration-management capability remains unchanged.
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
- Final full Vitest: 218 files / 1,720 tests passed.
- TypeScript typecheck: passed.
- Focused ESLint and `git diff --check`: passed.
- Actionlint: passed.
- Production build reached the unchanged `next/font/google` boundary and failed only because this network-restricted environment could not fetch Geist and Geist Mono from `fonts.googleapis.com`.
- Playwright is intentionally deferred to the following Phase 5C/6 runtime proof; this phase was explicitly scoped to unit/component/page verification.

## Scope and acceptance

No GitHub, Slack, Supabase-hosted, Azure, or other external call/write occurred. No Slack file or migration changed. Local database/pgTAP evidence is not required for this no-migration UI phase; it consumes the already reviewed Phase 5A RPC/RLS surface. A production/network-enabled build and later browser/runtime acceptance remain separate gates.

## Independent review and authority ruling

The first independent review found no Critical issue and five Important items. Four were corrected test-first: render the bounded exhausted queue and repository pagination, show mapping-pack approval/revocation lineage, align no-collection and exact-active-pack UI state, and restore the authorized-Owner strict payload test. Re-review then found the missing rule/mapping version presentation; a focused test failed RED and the validated versions now render on every result row.

The remaining concurrency question was accepted by the controller as an explicit architecture ruling, not silently dismissed. Task 3 materialisation is authorized by the durable active immutable Owner approval and deliberately runs without a current human actor from scheduled, webhook, daily, and manual prompt paths. The manual button adds prompt timing, not additional data or transition authority. Its action still requires exact active-org Owner context, strict target validation, the exact active reviewed mapping, and rate limiting before business service-client construction. A demotion after that boundary is equivalent to already-authorized automatic processing. This phase does not claim linearizable current-Owner authorization and does not add a misleading actor lock or migration.

Final independent re-review approved the current snapshot with no remaining Critical or Important finding. Its independent focused run passed five files / 98 tests, plus typecheck, touched-file ESLint, and `git diff --check`.
