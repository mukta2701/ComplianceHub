# Combine live GitHub connection fixes with Milestone 2 Monitoring

Research date: 24 September 2026. This note proposes integration; it does not record a merge, deployment or fresh live-provider test. The [release checklist](../release-checklist.md) remains the project status source.

## What happened

The repository has two divergent development histories. The Milestone 1 branch contains the deployed GitHub connection work; Milestone 2 developed its new per-check approval and Monitoring behaviour from an earlier shared commit. Keeping a separate branch did preserve that work, but did not automatically import later connection fixes.

Fresh repository inspection found a common ancestor `134ec30130b70d0be980a09cc67aca5fa5190313`. `git rev-list --left-right --count 3d6de05...c9128cc` returned **47 M1-only commits and 43 M2-only commits**. The M1-only changes include installation reconciliation, truthful connection health, retry-safe notices, Slack delivery and clearer alert links. M2 includes individual mapping decisions, exact result currentness, the revised Monitoring interface and the daily compliance collector. The incident candidate `61eb28b` adds five commits after `c9128cc`; it is a further candidate, not a separate product direction. These facts are reproducible with `git log --oneline --left-right 3d6de05...c9128cc` and `git log --oneline c9128cc..61eb28b`.

The [M1 checklist at 3d6de05](https://github.com/mukta2701/ComplianceHub/blob/3d6de05/docs/release-checklist.md) records application source `e955d2b` as deployed. The coordinating agent's fresh AWS `/api/health` read at approximately 08:56 UTC on 24 September reports release `3d6de059f3f8d84146b37f2af6050bf4d6c01e45` and database `ok`. Both facts can hold: `git diff --name-only e955d2b 3d6de05` lists documentation changes only. Use the freshly reported runtime SHA for the release identity; the earlier application-source reference is historical evidence, not a competing live release.

## Recommended resolution

Keep the approved Milestone 2 behaviour and integrate the live connection fixes into one candidate through a normal two-parent merge. Git merge combines changes since divergence and retains both histories. This is a recommendation for this repository, not proof that Git can resolve the application semantics automatically. [Git merge documentation](https://git-scm.com/docs/git-merge)

Rebase would replay the shared M2 commits and change their identity, disturbing the incident branch and existing evidence references. Git explicitly warns about rebasing branches on which other work depends. Cherry-pick copies selected commit changes into new commits; it suits a small independent fix, but manually selecting from this long dependent M1 sequence could omit required fixes. Prefer a merge for the complete integration. [Git rebase documentation](https://git-scm.com/docs/git-rebase#_recovering_from_upstream_rebase), [Git cherry-pick documentation](https://git-scm.com/docs/git-cherry-pick)

## Safe conflict inspection

1. Pin both source SHAs and inspect `git status` and `git worktree list`. Confirm the current hosted release separately. Use the existing isolated integration worktree if one already exists.
2. Preview conflicts with `git merge-tree --write-tree <m2-sha> <m1-sha>`. It creates no commit and does not touch the working tree or index, although it writes tree objects. An exit status of 1 denotes merge conflicts, not a completed integration. [Git merge-tree documentation](https://git-scm.com/docs/git-merge-tree)
3. Prepare the real candidate on its own `codex/` branch in a clean linked worktree. Linked worktrees have separate working files, index and HEAD while sharing the repository. Use `git merge --no-ff --no-commit <pinned-m1-sha>` to pause for inspection. Check conflicts against both implementations and their tests; do not choose one entire side merely because it is labelled “old” or “new”. [Git worktree documentation](https://git-scm.com/docs/git-worktree), [Git merge documentation](https://git-scm.com/docs/git-merge)
4. Review every resulting conflict resolution, including files Git merged automatically. Connection health must continue to govern access and warnings; per-check Owner decisions must continue to govern official compliance results. Those are complementary responsibilities.

## Evidence required before AWS

These gates follow the repository's [M2 acceptance plan](../plans/2026-09-23-trustworthy-monitoring.md), [CI workflow](../../.github/workflows/ci.yml) and [deployment workflow](../../.github/workflows/deploy-aws-dev.yml). Passing either parent branch's CI is insufficient evidence for the combined candidate.

- Run the integrated application's type, lint, unit/integration, secret, container and browser checks. Exercise both M1 connection loss/recovery behaviour and M2 approval/currentness/incident behaviour. Retest the previously identified stale mapping and scope-change cases.
- Rehearse both a clean database install and an upgrade from the schema corresponding to the deployed M1 application using a disposable database. Run database contracts against the combined migrations; a fresh install alone cannot establish upgrade compatibility. Follow the [local resource guard](../local-resource-guard.md), or use isolated CI where the supported local database environment is unavailable.
- Build and demonstrate the exact combined source locally. Verify Owner, Admin and Member views with clearly fictional data; capture the Monitoring summary, pending review and an exact result page. Assess whether a CISO can distinguish a connection issue, a confirmed failure, an expired check and an unreviewed mapping.
- Resolve the remaining M2 release scope and review findings before deployment. Package one immutable image; apply only the reviewed upgrade to the correct AWS dev database through the authorised release process. Verify the running release SHA and database health, then perform the bounded selected-repository and private-channel acceptance journey. A scheduled collector requires evidence of an actual scheduled execution, beyond a manual run.

No application code, branch history, database or AWS service was changed by this research. Primary Git documentation answers the integration mechanics; repository history and tests must answer whether this specific integration preserves behaviour.
