# Unfinished branch reconciliation and native integration port design

Date: 2026-09-04. Status: reconciliation complete; core assistance restoration implemented and under end-to-end verification. Native and collaboration ports remain pending.

The user explicitly included unfinished branches in the demo MVP audit. Missing work below must remain tracked, even where a later redesign left source files unused. A recommendation to defer a port does not authorize deleting its source.

## Baseline and method

Canonical commit: `dcded8801bd57657702bd91f91b5306004b673c4`, branch `codex/compliancehub-internal-tool`, repository `/Users/m1ghty/~ My Files/02 - Personal/ComplianceHub`. Parent task edits in progress are not part of the commit comparison. This audit inspected every root worktree, root branch ref and independent `.superpowers` clone; used `git cherry`, ancestry and tree/content comparisons; inspected staged and unstaged source separately from branch history. No checkout, merge, environment-file content inspection, remote mutation or database mutation was performed. Test presence and historical handoff evidence are distinguished from a fresh test run.

Source roots used below:

- E: `/Users/m1ghty/.config/superpowers/worktrees/ComplianceHub/codex-explain-and-act`
- A: `/Users/m1ghty/.config/superpowers/worktrees/ComplianceHub/codex-automation-platform`
- N: `/Users/m1ghty/.config/superpowers/worktrees/ComplianceHub/codex-native-integrations`
- R: `/Users/m1ghty/~ My Files/02 - Personal/ComplianceHub/.superpowers/native-integrations-resumed`
- I: `/Users/m1ghty/~ My Files/02 - Personal/ComplianceHub/.superpowers/compliancehub-internal-tool`

## Checkout ledger

| Branch / checkout | HEAD | Dirty state at inspection | Result |
| --- | --- | --- | --- |
| Canonical `codex/compliancehub-internal-tool` | `dcded8801bd57657702bd91f91b5306004b673c4` | Active parent edits | Baseline |
| `codex/compliancehub-integration` | `5bf50ce755784ac2ee78393dc3074e04bffb96b7` | Clean | All 21 divergent commits patch-equivalent; no merge needed |
| `codex/github-collection-foundation` in `codex-internal-mcp-digest` worktree | `be0d0a1642787257f866a7c64b3b8e614f29a92f` | Clean | Ancestor; zero unique commits |
| `codex/automation-platform` | `61ecc8bc963ff4b30179ae8e55f324696d0985aa` | Two staged files | Core automation incorporated; staged manual-first change remains absent |
| `codex/explain-and-act` | `43a012db7ebaea3b7afe73c4266b0a4b30ca277e` | Clean | Most backend/domain work incorporated; user-visible entry points omitted in later redesign |
| `codex/native-integrations` | `f1268f6573a30709ef3fe902837ab8b52014c305` | One tracked change; 14 untracked files | 17 genuinely unique native commits and early uncommitted worker work |
| R, independent clone `codex/native-integrations-resumed` | `f1268f6573a30709ef3fe902837ab8b52014c305` | 105 tracked changes; 20 untracked files; 114 source/test/migration paths | Most complete native/collaboration implementation, still uncommitted |
| I, independent clone `codex/compliancehub-internal-tool` | `dcded8801bd57657702bd91f91b5306004b673c4` | No tracked changes; 20 untracked files | Exact canonical commit; repeatability script/test already copied into root |
| Unchecked-out `codex/internal-mcp-digest` | `b87d3f7ce9a710b4194ffa00ef7e465cd8f55d91` | Not applicable | Eight old unique Azure deployment commits; two GitHub design commits patch-equivalent |
| `main`, `codex/demo-readiness-audit-2026-09-04` | `3a13219` | Not applicable | Ancestors; no missing source |

The E/A `git cherry` output contains plus signs for earlier implementations later adapted in the integration branch. A plus sign alone is not proof a feature is absent. Conversely, present backend files do not prove UI reachability.

Core restoration progress: audit preflight, optional task/evidence AI panels, assessment task/risk draft shortcuts, assessment/SoA saved-context AI and manual-first onboarding are restored in the current interface. Existing access and GitHub provenance tests remain in scope. Readiness-report AI remains with the reporting category; native Jira and recipient sharing have not yet been ported.

## Capability reconciliation and restoration order

| Order | Capability | Exact source paths relative to source root | Required reconciliation |
| --- | --- | --- | --- |
| 1 | Audit preflight | E `src/app/app/audits/page.tsx`, `src/features/audits/domain/preflight.ts` | Domain/tests canonical; restore index data loading and blockers UI into current Member-aware page |
| 1 | Optional AI task/evidence/readiness drafts | E `src/app/app/tasks/[id]/page.tsx:48`, `src/app/app/evidence/page.tsx:46`, `src/app/app/reports/readiness/page.tsx:24` | API/context/persistence/panel already canonical; restore settings loads and entry points, preserving current roles and GitHub provenance |
| 1 | Assessment/SoA AI and assessment draft shortcuts | E `src/components/assessment-response-form.tsx:54`, `src/app/app/assessment/[id]/page.tsx:16`, `src/components/soa-control-guidance.tsx`, `src/app/app/soa/[id]/page.tsx` | Preserve current guided layouts and deterministic explanations; add missing optional AI and task/risk draft navigation with save/completion safety |
| 1 | Manual-first onboarding | A staged `src/app/app/page.tsx`, `e2e/product.spec.ts:88` | Canonical still passes `hasIntegration`, rendering Connect a tracker as an onboarding step; selective change removes that requirement |
| 2 | Policy-to-control mappings | R `src/app/app/frameworks/{actions.ts,page.tsx}`, `src/features/controls/application/policy-mapping.ts`, migration `20260715050000_policy_control_mappings.sql`, DB test `068_policy_control_mappings.sql` | Add separate policy/shared-control relationship alongside current external-framework crosswalks |
| 2 | Private policy feedback notifications | R migration `20260715030000_policy_feedback_notifications.sql`, `src/app/app/notifications/page.tsx`, `src/features/policies/components/policy-feedback.tsx`, DB test `066_policy_feedback_notifications.sql` | Existing feedback RPCs must retain latest guards while atomically adding fixed-text, scoped notifications |
| 2 | Leadership report recipient sharing/revocation | R `src/app/app/reports/readiness/{actions.ts,page.tsx}`, `src/features/reports/application/leadership-sharing.ts`, `src/features/organisations/application/invitation-service.ts`, migration `20260715040000_leadership_report_shares.sql` | Port recipient access together with PDF rules, invitation acceptance, delivery lifecycle and revocation; current canonical publishing shares snapshots generally with Members |
| 3 | Native Jira OAuth; reconciliation of older native GitHub implementation | R `src/app/api/integrations/{github,jira}/{connect,callback}/route.ts`; `src/features/integrations/application/{authorization-state,github-app,jira-oauth,jira-token-store,provider-config}.ts`; integrations page/catalog/actions | Jira native flow is absent. GitHub native installation/selection already exists under canonical `src/features/github` and `/api/github/*`; do not mistake absent older file paths for an absent capability. Preserve canonical GitHub authority and port only proven check gaps |
| 3 | Jira webhooks and durable workers; reconciliation of older GitHub worker | R `src/app/api/webhooks/github/route.ts`, `src/app/api/webhooks/jira/[token]/route.ts`, `src/app/api/cron/integrations/route.ts`; application `{native-sync-worker,sync-jobs,webhook-ingestion,webhook-security,jira-webhook-lifecycle}.ts` | Jira requires native schema, lease ownership and scoped manual processing. Canonical GitHub signed webhook and leased collection workers already exist and must remain authoritative |
| 3 | Durable native Slack alert queue | R monitoring `{deliver,monitor-deps,slack-webhook}.ts`, migration `20260715020000_connection_notifications_and_alert_delivery.sql` | Keep canonical destination approval and newer digest lifecycle; port native queue without replacing them |
| 4 | Register module explainers | E `src/app/app/{assets,audits,evidence,kpis,policies,risks}/page.tsx` | Component/data present; add missing guidance only where it complements current UI |
| 4 | AWS Security Hub evidence adapter | E `src/features/integrations/application/aws-evidence.ts`, `.test.ts`, package dependency `@aws-sdk/client-securityhub` | Preserve as deferred candidate: ambient SDK credentials and a maximum 100-findings count are not a tenant credential design; canonical deliberately fails closed |
| Preserve separately | Old Azure Adtecher deployment split | Root ref `codex/internal-mcp-digest`: `.github/workflows/deploy-azure-adtecher-staging.yml`, `scripts/azure/{rollout-container-app,smoke-container-app}.sh` | Not part of demo capability port; reconcile with newer Azure history separately, never delete automatically |

R is the source of truth for unfinished native work, not N's early untracked files: `webhook-security.ts`, `webhook-ingestion.ts`, `sync-jobs.ts`, and `native-sync-worker.ts` all differ between them. R contains staged plus later unstaged edits; a patch of only its index is incomplete.

Never replace the canonical repository wholesale with R. Its `evidence-registry.ts` removes live adapters and throws in production; its tracker/provider cleanup and broad UI replacements predate current GitHub collection/provenance/MCP behavior. Its package/lockfiles predate the current runtime. Those changes are not a coherent forward port.

## Evidence and remaining validation

R `docs/codex-overnight-notes.md` dated 2026-07-15 reports an isolated fresh database with migrations through `20260715060000`, 71 pgTAP files / 1,466 assertions, 151 application files / 925 tests, three Supabase integration tests, 25 desktop journeys, four mobile journeys, and lint/typecheck/build passing. This is historical evidence only. No stale branch test suite was rerun during this read-only audit. Real hosted provider/invitation round trips were explicitly still outstanding.

Source tests cover native OAuth state, refresh ownership, signatures, replay detection, bounded payloads, worker leases/fairness, parent-child processing, report access, and Member boundaries. Every port requires fresh validation against canonical schema and current pages, including current Member and official GitHub provenance suites.

## Native coexistence and migration audit

### Existing canonical architectures

There are three distinct existing paths. They must not be collapsed by copying the old branch:

1. **Official GitHub collection:** `src/features/github/application/{github-app-auth,github-user-oauth,installation-claim,collection-deps,run-collection,webhook-worker,materialise-approved-observations,github-record-provenance}.ts`; `/api/github/{setup,callback,webhook}`; `/api/cron/github-collect`. `github_installations` is the installation authority, `github_repositories` is the selected repository authority, and `github_collection_runs` / `github_observations` are the evidence acquisition ledger. Mapping approval, materialisation jobs, evidence/finding provenance, and official results provide downstream publication. Do not write official records outside this chain.
2. **Broker tracker and monitoring:** `integration_connections` and `monitor_sources` with modes `sandbox` / `oauth`, opaque broker references and broker lifecycle triggers; tracker actions and `/api/cron/integrations-sync` remain current paths. An existing broker connection may retain ticket-write capabilities; introducing a native read-only connection must not silently disable it or inherit that write capability.
3. **Legacy evidence collection:** `evidence_sources` and `src/features/integrations/application/{evidence-registry,github-evidence,google-workspace-evidence,collect-run}.ts`. The GitHub adapter uses an explicit source token to collect bounded protected-branch counts. It is not the official GitHub provenance pipeline. Existing source identity must not silently become a native installation identity. AWS remains unavailable pending a credential design.

Canonical `20260817010000_github_collection_foundation.sql` anchors installation/repository/run/observation ownership with composite tenant ancestry FKs. Later `20260824184628_github_compliance_materialisation.sql`, `20260824212223_github_materialisation_jobs.sql`, `20260825014236_github_official_results_and_mcp_read.sql` and subsequent migrations strengthen the publication chain. R predates all of these.

### Concrete migration conflicts

| Source | Conflict with canonical | Forward-port requirement |
| --- | --- | --- |
| R `20260714170000_native_connections_and_targets.sql:4` | Revokes every active broker OAuth connection; its mode constraint permits `oauth` only as disabled/revoked tombstones | Omit the data revocation. Preserve active broker branch of the constraint and add native Jira as a separate allowed mode |
| Same migration lines 10–16 | Drops `integration_connections_sync_github_monitor`, `integration_connections_immutable_oauth_identity`, `monitor_sources_enforce_linked_oauth_lifecycle` and their functions | Preserve broker behavior. Add mode-dispatched native guards or separate native triggers which return without affecting broker rows |
| Canonical `20260818040000_harden_oauth_trigger_permissions.sql` | Executes `alter function public.enforce_linked_oauth_monitor_source() security definer`; old native migration would have removed that function earlier in a fresh replay | Do not insert original July migration files into canonical history. Use newly generated forward migrations after current HEAD and retain the function |
| R first native migration `monitor_sources_mode_check` / index changes | Turns broker monitor rows into tombstone-only mode; removes one-source-per-connection index to support targets | Keep a partial unique index for legacy broker sources, add target-based uniqueness for native Jira, and preserve broker FK/lifecycle checks |
| R `list_connected_monitor_sources(uuid)` | Drops/replaces canonical safe summary RPC with a changed shape/semantics | Introduce a versioned safe summary RPC/facade instead of changing an existing result contract under current callers |
| R first native migration Slack dedupe | Revokes all but newest active Slack channel and enforces one per workspace | Do not run this destructive normalization; current digest/approved-destination flows own Slack behavior. Add native alert queue without changing channel cardinality |
| R `20260714174000_github_app_persistence.sql` and generic GitHub targets | Creates second installation authority in `integration_connections` and second repository authority in `integration_connection_targets` | Do not port these GitHub persistence RPCs into active use. Preserve source and map useful behavior to existing `github_installations`/`github_repositories` |
| R `20260714171000`, `172000`, `175000`, `223000` through `20260715013000`, and `20260715060000` | Definitions are incremental and frequently replace earlier job/refresh functions; cherry-picking only base migrations omits refresh fencing, fairness, wakeup and scoped processing fixes | Extract final definitions into dependency-ordered new migrations; retain all relevant Jira tests and lease/generation invariants |
| R `20260715030000_policy_feedback_notifications.sql` | Replaces canonical `create_policy_feedback` / `reply_policy_feedback` | Compose atomic notifications into latest canonical definitions and keep current authorization rules |
| R `20260715040000_leadership_report_shares.sql` | Replaces `accept_invitation`; changes `publish_leadership_report` signature/visibility model | Port separately from native integrations; preserve verified-email checks and migrate existing snapshot visibility explicitly |
| R historical pgTAP edits | Rewrites existing tests to assume broker removal | Preserve canonical tests unchanged, add new native tests under unused names; test all supported modes together |

This inspection searched function-definition names across canonical and R migrations; the overlapping names found are the monitoring summary RPC, policy feedback RPCs, leadership publication and invitation acceptance. Absence of a name collision is not proof of semantic compatibility: constraints, grants, shared columns and data updates are the primary native conflicts.

### Credential and access boundaries

- Canonical `collection-deps.ts:191` mints one in-memory installation token scoped to the exact selected repository IDs and read permissions. R `github-app.ts` obtains an installation-wide Octokit client. Keep the canonical token path; do not introduce R's broader credential path for monitoring, legacy evidence or new UI.
- Keep canonical GitHub ownership proof, `GITHUB_ALLOWED_ACCOUNT_ID` policy, and Owner-only `/api/github/setup` admission. R's Owner/Admin native management convention does not authorize broadening current GitHub access. A separate approved capability change would be required to broaden that behavior.
- Native Jira uses encrypted access/refresh tokens (`v1` AES-GCM form via `APP_ENCRYPTION_KEY`), cloud/site identity, token version, a leased refresh owner and webhook generation fencing. Port its final refresh/disconnect/cleanup state as one unit. Never expose credentials through connection summaries or return raw provider errors.
- Reuse the encryption format rather than rotating existing keys or rewriting current stored credentials during this port. Add R's strict `decodeBase64Secret` only for new configuration parsing that needs it; no secret values were inspected in this audit.
- `integration_authorization_states`, `pending_jira_authorizations`, webhook receipts, jobs, cleanup credentials and refresh RPCs remain server-only. Revoke PUBLIC/anon/authenticated access where applicable and grant only required service operations. Safe summaries use role-aware, tenant-scoped functions/column grants. Members receive safe summaries, never provider mutation controls or direct worker RPCs.
- For every privileged operation, resolve tenant, provider, mode, lifecycle generation and target from stored identity, not request-supplied IDs alone. A revoked/reconnected Jira parent must invalidate old refresh owners, webhook callbacks and queued children.
- Retain canonical Slack `approveSlackDestination` both when configuring a native channel and at delivery. R's URL-shape validator does not replace approved destination checks.

### Proposed coherent coexistence design

**Decision:** keep the current GitHub engine, add native Jira alongside broker connections, and aggregate safe presentation above the two engines. This preserves unfinished native features without reviving a duplicate installation/token system.

1. Add Jira-specific capabilities to `integration_connections` using the new `jira_oauth` mode while preserving `sandbox` and active broker `oauth`. Add tenant/provider-bound `integration_connection_targets` for native Jira projects. The target table may preserve extensible provider structure, but no GitHub rows are created during this port. Add native Jira monitor sources derived from those targets, with partial constraints/indexes that leave broker monitor behavior intact.
2. Adapt R's final authorization, pending-site selection, refresh, webhook lifecycle and disconnect code for Jira. Keep route namespace `/api/integrations/jira/{connect,callback}` and `/api/webhooks/jira/[token]`. Existing `/api/github/*` endpoints remain the only active GitHub installation/callback/webhook endpoints.
3. Port a Jira-scoped version of R's durable queue and manual worker. It claims only native Jira jobs; existing GitHub workers own GitHub runs. Preserve parent/child identity, fair scheduling, lease fencing, retries, cleanup and caller-scoped manual completion. Do not make the new worker drain all existing GitHub or broker work.
4. Build a safe application-layer connection summary union tagged by `engine: github_collection | native_jira | broker | sandbox`. The UI can show one coherent Connections surface while routing each action to its existing authority. An ID without the engine tag is insufficient for mutation dispatch. Preserve safe Member rendering and existing GitHub repository panel.
5. Monitoring may show native Jira findings alongside current official GitHub results. Preserve source-engine provenance in presentation and do not represent generic native findings as approved GitHub official results. Jira-to-compliance materialisation should remain explicitly separate until it has its own reviewed mapping and provenance contract.
6. Preserve R's generic GitHub adapter/schema in the unfinished-work ledger as superseded implementation. Map old checks to canonical equivalents before declaring parity: old branch protection/review and secret-scanning checks overlap current checks; old `github.org_mfa` and seven-day `github.failed_default_branch_workflows` have no exact check IDs in current 15-check rule pack. Track those two as potential missing behavior and verify semantics before addition. If adopted, implement through current fact collection, rule versioning, mapping approval and materialisation, with appropriate permissions and unknown/unavailable states. Do not publish duplicate generic findings.
7. Add native alert delivery retry/cancel functionality only after the Jira lifecycle works. The new queue must retain canonical destination restrictions and remain independent of current daily-digest delivery semantics.

### Forward migration and verification sequence

No historical migrations should be edited or inserted for this port. Generate new migration names with the installed CLI when implementation begins; this design intentionally supplies dependency names, not invented timestamps.

1. **Enums and additive native Jira foundation:** introduce Jira monitor enum value in a separately committed migration before SQL that uses it; add final columns, mode constraints, target identities and indexes without broker data updates. Existing data must remain valid without revocation or deletion.
2. **Jira authorization and credentials:** state tables, pending-site records, refresh leases/versioning, secret access RPCs, scoped connect/disconnect, safe summary functions. Add grants/RLS explicitly and validate both Member and operator access.
3. **Jira queue and webhook lifecycle:** final job/receipt constraints, lease functions, cleanup queue, callback token generation/fencing, scheduling, parent-child fair processing and manual subtree status. Compile final definitions together rather than replaying intermediate unsafe variants.
4. **Applications and UI:** provider-specific dispatch and the summary union; preserve current routes and existing package versions, add only dependencies actually needed by the Jira port. No Octokit dependency is needed merely to reproduce R's old GitHub implementation.
5. **Alerts:** optional native queue and configured cron runner integrated with current hosting scheduler; no changes to remote cron, callbacks or credentials during local design/implementation.

Use an isolated local database for both a clean canonical-plus-port install and an upgrade from canonical populated fixtures. Include active broker GitHub/Jira connections, a selected official GitHub repository with materialised evidence/finding provenance, historical task-ticket links, pending invites, multiple alert channels and Member accounts. Assert every existing identifier, broker state and official result survives unchanged.

Required focused tests: cross-tenant callback/target substitution; Member RPC denial; no credential fields in summaries; simultaneous refresh with stale lease completion; reconnect vs stale callback; duplicate webhook and oversized body; webhook cleanup after disconnect; retry/fairness and lost wakeups; manual job outcome isolated to its parent; old broker monitor trigger still runs; existing GitHub installation ownership and narrow token tests stay green; mapping approval/provenance/MCP reads remain correct; old task-ticket operations dispatch only to broker modes; new Jira mode cannot create/edit provider tickets; approved Slack destination still required. Then current application/DB suites, production build and browser journeys for each mode.

Readiness remains unverified until those tests run. This document is a design and preservation ledger, not a claim that a native port has been implemented or that hosted providers are configured.

### Current provider documentation checked before porting

Checked Atlassian primary documentation on 2026-09-04. Jira 3LO uses user-bound OAuth state, API calls through `api.atlassian.com`, and rotating refresh tokens. Request `offline_access` for refresh; replacements must be persisted safely. [OAuth 2.0 guide](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/).

Dynamic OAuth webhooks use bearer tokens signed with the app client secret, expire after 30 days, and require renewal. The documented OAuth limit is five webhooks per app/user/tenant. Preserve signature checks, scoped event handling and renewal in the resumed implementation. [Jira webhook guide](https://developer.atlassian.com/cloud/jira/platform/webhooks/).
