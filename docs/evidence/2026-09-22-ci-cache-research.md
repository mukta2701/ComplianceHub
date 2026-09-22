# CI container cache research — 22 September 2026

## Finding

Docker layer caching is already configured and working. No workflow change is recommended for the present CI failure.

Both `origin/main` (`134ec30`) and the Milestone 1 candidate (`388934d`) configure `docker/setup-buildx-action@v3`, `docker/build-push-action@v6`, `cache-from: type=gha`, and `cache-to: type=gha,mode=max` in `.github/workflows/ci.yml`. The hosted candidate's [container job](https://github.com/mukta2701/ComplianceHub/actions/runs/35775451396/job/106907900350) succeeded: its log shows a GitHub cache manifest import followed by eleven `CACHED` build steps. This is fresh hosted evidence; no local build was run for this research.

## What the primary sources establish

- Docker documents the existing `type=gha` import/export configuration. API v2 requires current Buildx/BuildKit; Docker says the tools supplied on GitHub-hosted runners are current. There is no observed legacy-cache error here. [Docker cache management](https://docs.docker.com/build/ci/github-actions/cache/)
- An explicit cache `scope` can separate multiple images; the default is `buildkit`. Cache export `ignore-error=true` suppresses export failures, while `version=2` explicitly selects the current API. These are available options, not demonstrated fixes for this run. [Docker GHA backend](https://docs.docker.com/build/cache/backends/gha/)
- Branch boundaries restrict cache access. Credentials must stay out of cached content, including because pull requests can read base-branch caches. Existing CI uses placeholder public build arguments. [GitHub dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)

## Recommendation and verification

Keep the workflow unchanged and address the failing database assertions using their job logs. Adding the same cache settings would do nothing. Separating CI/deployment cache scopes or making optional cache exports non-fatal can be considered if future logs demonstrate contention or export failures; neither is evidenced here.

No new test is needed for this research-only result. For any future cache edit, validate workflow syntax with `actionlint`, preserve the image build/smoke checks, and inspect a real hosted run for successful cache import/export and reused layers. A static string assertion alone cannot prove caching works.
