# Canonical Workspace Stabilization Design

**Date:** 2026-09-04  
**Status:** Approved in chat; awaiting written-spec review  
**Canonical candidate:** `codex/compliancehub-internal-tool` at `13d4c59`

## Purpose

Restore one trustworthy development and runtime path for ComplianceHub without
losing unfinished work. The repository root, application runtime, MCP client
catalogue, and future implementation work must all refer to the same source
tree and current MCP contract.

## Verified Current State

- The primary checkout is on `main` at `3a13219` and contains the older July
  application.
- The healthy application and local MCP endpoint on port 3100 run from the
  nested clone `.superpowers/compliancehub-internal-tool` on
  `codex/compliancehub-internal-tool` at `13d4c59`.
- That branch is 88 commits ahead of its incorrectly selected upstream,
  `origin/codex/github-collection-foundation`.
- The current Codex host advertises an older MCP contract: it includes
  `post_daily_digest`, omits `list_github_compliance_results`, and describes
  the version-1 digest schema. Current source and configuration define seven
  read/preparation tools, omit delivery, and use the version-2 digest schema.
- Several other worktrees and clones contain divergent commits or uncommitted
  changes. They are not safe to delete merely because the current application
  does not run from them.
- Generated Next.js caches, dependency installations, Playwright recordings,
  screenshots, and logs account for most of the disk usage and visible
  workspace noise.

## Decision

Use `codex/compliancehub-internal-tool` as the canonical operational baseline.
Import it into the primary repository, make the normal ComplianceHub directory
the working checkout for that branch, and run the application and MCP from
that directory.

This decision establishes the current working product as the baseline; it does
not assert that every divergent historical branch has already been integrated.
Those branches remain recovery inputs until reviewed separately.

## Target State

After stabilization:

1. `/Users/m1ghty/~ My Files/02 - Personal/ComplianceHub` is the only active
   ComplianceHub source and runtime directory.
2. Its checked-out branch is `codex/compliancehub-internal-tool`, imported into
   the primary repository with full history.
3. The application on port 3100 starts from the canonical directory.
4. The ComplianceHub MCP configuration is project-scoped and exposes exactly:
   `list_workspaces`, `get_compliance_overview`, `list_attention_items`,
   `list_monitoring_findings`, `list_github_compliance_results`,
   `get_latest_leadership_report`, and `prepare_daily_digest`.
5. `post_daily_digest` is not exposed to the local Phase 3 client.
6. Codex is restarted after configuration changes so it negotiates the current
   MCP server identity and schemas.
7. Divergent or dirty work remains recoverable outside the active source path.
8. Disposable caches and recordings no longer obscure repository status or
   consume multi-gigabyte storage.

## Preservation Boundary

Before switching, moving, or deleting anything, create a dated recovery area
outside the active repository. For every checkout or clone with changes,
capture:

- repository origin, branch, HEAD, upstream, and porcelain status;
- a Git bundle containing committed refs available to that repository;
- a binary patch of tracked changes relative to HEAD;
- an archive of untracked, non-ignored files;
- a checksum manifest for the recovery artifacts.

Validate every bundle, patch presence, archive readability, and checksum before
continuing. A dirty source tree remains in place until its recovery artifacts
pass validation.

No previous branch is merged, rebased, reset, or deleted during this
stabilization. No remote push occurs without separate approval.

## Canonicalization Flow

1. Record the complete pre-change inventory and create validated recovery
   artifacts.
2. Import `codex/compliancehub-internal-tool` from the nested clone into the
   primary repository under the same local branch name.
3. Confirm that the imported commit and tree hashes match the source clone.
4. Preserve the primary checkout's current untracked evidence files, then
   switch the primary checkout to the imported branch.
5. Transfer only the active branch's relevant untracked source/evidence files;
   do not transfer `.next`, `node_modules`, browser recordings, or other
   generated state.
6. Install dependencies from the canonical lockfile and run the repository's
   verification commands.
7. Stop the nested-clone development server and start the server from the
   canonical directory.
8. Confirm that the listening process has the canonical directory as its
   working directory.

If any hash comparison, source transfer, install, test, build, or health check
fails, stop and retain the original runtime and source clone for rollback.

## MCP and Tool Scope

Move the safe local ComplianceHub server declaration from the user-global
configuration into trusted project configuration. Keep the explicit seven-tool
allowlist and the `post_daily_digest` deny rule.

The first cleanup does not uninstall Supabase, browser support, OpenAI
documentation, or unrelated plugins. Standalone Playwright MCP may be disabled
only after canonical browser-based local testing succeeds. Supabase remains
available because it is an application dependency; authentication and any
global-versus-project scoping decision are handled separately.

After configuration changes, restart the Codex desktop host and open a fresh or
resumed task from the canonical project. Verify the negotiated tool names and
the version-2 digest schema before using ComplianceHub MCP results.

## Generated-Data Cleanup

Cleanup is deliberately sequenced after canonical verification. Eligible
targets are limited to reproducible or evidentiary noise:

- `.next` directories in obsolete clones;
- duplicate `node_modules` directories in obsolete clones;
- `.playwright-mcp` recordings and console logs after any needed evidence is
  archived;
- root-level screenshots, snapshots, and proof files after they are archived
  or moved to their documented evidence location;
- obsolete test output and build caches.

Source files, Git metadata, environment files, migrations, tests, plans, and
uncommitted work are not disposable. Environment backups containing credentials
must be handled as sensitive data and never copied into Git or diagnostic logs.

## Divergent-Branch Reconciliation

Automation, integration, explanation, and native-integration branches that are
not ancestors of the canonical branch remain quarantined recovery inputs. A
later, separate review will compare their user-visible capabilities and tests
against the canonical branch. Only missing, still-desired behavior will be
ported, preferably as small reviewed changes with tests.

This avoids both failure modes: silently losing prior work and blindly merging
large obsolete implementations into a healthy current product.

## Verification

Stabilization is complete only when all of the following are demonstrated:

- recovery manifests and checksums validate;
- canonical imported commit/tree hashes match the source clone;
- dependency installation succeeds from the canonical lockfile;
- lint, type checking, tests, and production build pass;
- `/api/health/live` returns HTTP 200;
- `/api/health` returns HTTP 200 with database status `ok`;
- protected-resource metadata identifies `http://127.0.0.1:3100/mcp`;
- the active port-3100 process runs from the canonical directory;
- authenticated `list_workspaces` and `get_compliance_overview` calls succeed;
- the refreshed Codex tool catalogue exposes the seven approved tools and no
  delivery tool;
- the canonical working tree has only explicitly retained changes.

## Rollback

Until final verification succeeds, the nested clone and its environment remain
untouched apart from stopping or starting its development process. If the
canonical runtime fails, stop it and restart the prior nested-clone server on
port 3100. Recovery bundles, patches, archives, and manifests provide an
independent restoration path.

## Out of Scope

- merging divergent feature branches;
- changing product behavior or MCP business logic;
- delivering Slack messages;
- pushing branches or tags to GitHub;
- uninstalling plugins or removing Supabase;
- deleting preserved source trees before a later reconciliation decision.
