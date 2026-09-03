# Phase 1 Monitoring UI implementer report — 2026-09-02

## Status

Complete. The Phase 1 Monitoring page now presents a truthful, user-facing GitHub monitoring experience while preserving the existing collection, materialisation, database, MCP, Slack, GitHub permission, provenance, and finding-action contracts.

No commit, merge, push, publish, Slack post, external GitHub request, or live GitHub recheck was performed. The existing development server was reused without restart. Browser verification used only the local Supabase test stack and synthetic local records.

## Implemented behavior

- Visible order is summary, GitHub repository monitoring, active findings, any non-GitHub monitored systems, then a closed `Technical review and recovery` disclosure.
- One active GitHub App installation counts as one monitored system independently of current permission health. Legacy GitHub monitor sources are de-duplicated; non-GitHub sources appear separately only when present.
- Zero persisted findings use neutral `No recorded active findings` and `Monitoring status is not yet confirmed` wording, without a green success indicator.
- GitHub monitoring covers disconnected, no selected repository, never checked, running, current, issue, partial, failed, rate-limited, and stale-at-36-hours states in the required language.
- Repository cards show a human-readable `Last checked` time.
- Owner actions show `Check GitHub now`, then disabled `Checking GitHub…` with `aria-busy=true`; success refreshes, while rejected/failed actions show a safe live-region error and do not refresh.
- Admins and Members remain read-only. Owner/Admin connection guidance links to `/app/integrations`; Members receive read-only guidance.
- The security boundary says GitHub access reads settings and metadata and never changes GitHub, while a check can update ComplianceHub evidence and findings.
- The outer technical review and inner 15-check catalogue are closed by default.
- Active GitHub findings use an exhaustive, explicit 15-check reviewed presentation map. Plain-language title, explanation, remediation, repository, severity, status, ISO references, observed time, and permitted actions remain visible. Raw check ID, rule/mapping versions, checksum, materialised/first-detected provenance, treatment text, and the long compliance caveat are preserved under a closed `Technical evidence` disclosure.
- Monitoring has route-local loading and error surfaces with safe copy and retry.
- Responsive styles stack banners, actions, and cards at phone width, provide full-width touch actions, wrap long repository names/timestamps, and preserve keyboard focus.

## TDD evidence

### RED 1 — core Monitoring experience

Command:

```text
npm test -- src/features/github/components/github-collection-health-panel.test.tsx src/app/app/monitoring/page.operator.test.tsx src/app/app/monitoring/page.member.test.tsx src/app/app/monitoring/page.github-provenance.test.tsx src/app/app/monitoring/monitoring-boundaries.test.tsx
```

Expected result: exit 1; five test files failed; 11 tests failed and 6 passed. Failures demonstrated missing loading/error modules, old collection terminology and states, missing role-aware action API, incorrect GitHub count/de-duplication, non-neutral zero-finding copy, and missing closed technical hierarchy. No production file had been edited before this RED run.

### RED 2 — inner catalogue default state

Command:

```text
npm test -- src/features/github/components/github-compliance-control-room.test.tsx
```

Expected result: exit 1; one test failed and 10 passed. The new assertion proved `Review all 15 mapped checks` still had the `open` attribute.

### RED 3 — plain-language active findings

Command:

```text
npm test -- src/features/github/components/github-record-provenance.test.tsx
```

Expected result: exit 1; one test failed and 5 passed. The new assertion could not find `GitHub finding: Stale approvals are dismissed`; the existing card was still named and headed by `github.branch.stale_approvals` and exposed technical provenance by default.

### GREEN — focused behavior and regressions

Command:

```text
npm test -- src/features/github/components/github-check-presentation.test.ts src/features/github/components/github-collection-health-panel.test.tsx src/features/github/components/github-compliance-control-room.test.tsx src/features/github/components/github-record-provenance.test.tsx src/features/monitoring/components/member-monitoring.test.tsx src/app/app/monitoring/page.operator.test.tsx src/app/app/monitoring/page.member.test.tsx src/app/app/monitoring/page.github-provenance.test.tsx src/app/app/monitoring/monitoring-boundaries.test.tsx src/features/github/components/github-monitoring-route-boundary.test.ts
```

Result: exit 0; 10 test files and 58 tests passed. This includes one test for each of the 15 approved GitHub check IDs and a safe fixed fallback for an unrecognised identifier.

### RED 4 — active-finding headings must state the issue

Command:

```text
npm test -- src/features/github/components/github-record-provenance.test.tsx
```

Expected result: exit 1; one test failed and 5 passed. The new assertion expected `GitHub finding: Stale approvals are not dismissed`, but the card still used the desired-state title `Stale approvals are dismissed`, which could read as a false pass.

The bounded 15-check map was then changed so every active-finding title states the observed problem, including `Repository is publicly visible`, `Force pushes are allowed`, `Default branch can be deleted`, `Too few approving reviews are required`, `Required status checks are missing`, and `Security workflow is missing or failing`.

Final affected-subset command:

```text
npm test -- src/features/github/components/github-check-presentation.test.ts src/features/github/components/github-record-provenance.test.tsx src/features/monitoring/components/member-monitoring.test.tsx src/app/app/monitoring/page.github-provenance.test.tsx
npm run typecheck
npx eslint src/features/github/components/github-check-presentation.ts src/features/github/components/github-check-presentation.test.ts src/features/github/components/github-record-provenance.tsx src/features/github/components/github-record-provenance.test.tsx src/features/monitoring/components/member-monitoring.test.tsx src/app/app/monitoring/page.github-provenance.test.tsx
git diff --check
```

Result: exit 0; 4 test files and 30 tests passed; typecheck, affected lint, and diff-check also passed. Per the task-owner ruling, the already-green full suite was not rerun after this presentation-copy-only correction.

## Verification

### Typecheck, focused lint, and diff hygiene

Commands:

```text
npm run typecheck
npx eslint src/app/app/monitoring/page.tsx src/app/app/monitoring/loading.tsx src/app/app/monitoring/error.tsx src/app/app/monitoring/monitoring-boundaries.test.tsx src/app/app/monitoring/page.operator.test.tsx src/app/app/monitoring/page.member.test.tsx src/app/app/monitoring/page.github-provenance.test.tsx src/features/github/components/github-collection-health-panel.tsx src/features/github/components/github-collection-health-panel.test.tsx src/features/github/components/github-compliance-control-room.tsx src/features/github/components/github-compliance-control-room.test.tsx src/features/github/components/github-record-provenance.tsx src/features/github/components/github-record-provenance.test.tsx src/features/github/components/github-check-presentation.ts src/features/github/components/github-check-presentation.test.ts src/features/monitoring/components/member-monitoring.tsx src/features/monitoring/components/member-monitoring.test.tsx e2e/github-shadow-collection.spec.ts
git diff --check
```

Result: all exited 0 with no lint warnings or whitespace errors.

### Full test suite

Command: `npm test`

Result: exit 0; 236 test files passed; 1,911 tests passed and 1 test was skipped (1,912 total).

### Production build

Command: `npm run build`

Result: exit 0. Next.js 16.3.0 compiled, typechecked, generated all 29 static pages, and included `/app/monitoring` as a dynamic route.

Non-blocking warning: Next ignored a parent `package-lock.json` outside this Git repository and suggested configuring `turbopack.root`. This predates and is unrelated to this UI change.

### Desktop and mobile browser checks

The first default-port attempt exited 1 because an existing Next development server already held the worktree lock. A second attempt against its actual port exited 1 because Playwright intentionally requires explicit local Supabase variables. No service was stopped or restarted. Variables were then sourced from `supabase status -o env` without printing values, and the existing server was reused.

Commands (secret values were not printed):

```text
source =(npx supabase status -o env 2>/dev/null)
export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export PLAYWRIGHT_PORT=3100
export NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3100
npx playwright test e2e/github-shadow-collection.spec.ts --project=chromium
npx playwright test e2e/github-shadow-collection.spec.ts --project=mobile
```

Results: Chromium exit 0, 1 test passed; Mobile/Pixel 5 exit 0, 1 test passed. The flow verifies axe accessibility, both default-closed disclosures, required language, human-readable last-check content, and whole-document/component overflow at 1440, 1024, 801, and 390 pixels. It never clicks `Check GitHub now` and makes no external GitHub request.

## Files changed by this task

- `e2e/github-shadow-collection.spec.ts`
- `src/app/app/monitoring/error.tsx`
- `src/app/app/monitoring/loading.tsx`
- `src/app/app/monitoring/monitoring-boundaries.test.tsx`
- `src/app/app/monitoring/page.github-provenance.test.tsx`
- `src/app/app/monitoring/page.member.test.tsx`
- `src/app/app/monitoring/page.operator.test.tsx`
- `src/app/app/monitoring/page.tsx`
- `src/app/globals.css`
- `src/features/github/components/github-check-presentation.test.ts`
- `src/features/github/components/github-check-presentation.ts`
- `src/features/github/components/github-collection-health-panel.test.tsx`
- `src/features/github/components/github-collection-health-panel.tsx`
- `src/features/github/components/github-compliance-control-room.test.tsx`
- `src/features/github/components/github-compliance-control-room.tsx`
- `src/features/github/components/github-record-provenance.test.tsx`
- `src/features/github/components/github-record-provenance.tsx`
- `src/features/monitoring/components/member-monitoring.test.tsx`
- `src/features/monitoring/components/member-monitoring.tsx`
- `docs/evidence/phase1-monitoring-ui-implementer-report-2026-09-02.md`

`src/features/github/components/github-installation-panel.tsx` and its test were already modified before this task and were not touched. All unrelated dirty and untracked files were preserved.

## Final blob IDs

| File | Blob ID |
|---|---|
| `e2e/github-shadow-collection.spec.ts` | `80310ecf01316360e1a4e6904c615a5e0f5eb922` |
| `src/app/app/monitoring/page.github-provenance.test.tsx` | `8498ef8509f04aabbbd272bae0811544d12cb987` |
| `src/app/app/monitoring/page.member.test.tsx` | `ff7d707557c9e1db1162494c81fead05f87a6308` |
| `src/app/app/monitoring/page.operator.test.tsx` | `597b4ccb2e0d030d8441ec8ce7bcf91096ddbe99` |
| `src/app/app/monitoring/page.tsx` | `cbb76711f152a6b009f5323fc9cee18ab67249ce` |
| `src/app/app/monitoring/error.tsx` | `22136bf1b3d5c5a1327ed386a76a7f7db9efa317` |
| `src/app/app/monitoring/loading.tsx` | `4c467dd095384347a95784b5d1dd193c0232544c` |
| `src/app/app/monitoring/monitoring-boundaries.test.tsx` | `811eb93b38407a2c62f6c4303dd6bfcc39cbc4b3` |
| `src/app/globals.css` | `f634221188e795e1c2c474482389f6a42246bdeb` |
| `src/features/github/components/github-check-presentation.test.ts` | `56b440225a3678c4e7805659738b9d4ffcdd484a` |
| `src/features/github/components/github-check-presentation.ts` | `ba003c2f14c376c7cdda271231dac0174eeda6b6` |
| `src/features/github/components/github-collection-health-panel.test.tsx` | `eca0a9bbf5d249c60df46c1a9f49acd40e12cb73` |
| `src/features/github/components/github-collection-health-panel.tsx` | `3494373d1c66c511f2243293a838b04b329bded6` |
| `src/features/github/components/github-compliance-control-room.test.tsx` | `bde44bbd7bf14b0064ae1f7d82b6beef7b665c6b` |
| `src/features/github/components/github-compliance-control-room.tsx` | `6324edacb5dc1cbd06a51448710da9671cc384bf` |
| `src/features/github/components/github-record-provenance.test.tsx` | `23c28253dc4ec51786e80a8d537795bcf69de2e8` |
| `src/features/github/components/github-record-provenance.tsx` | `7a726b66d62a5f422205c9acb62f964c70c21dea` |
| `src/features/github/components/github-monitoring-route-boundary.test.ts` | `fedab71621383a687b920c20b7e2501a8269fd65` |
| `src/features/monitoring/components/member-monitoring.test.tsx` | `f2f9d44f95a8eb6b02cc3c7f6f6a39d28950437c` |
| `src/features/monitoring/components/member-monitoring.tsx` | `a5596619d9930c403fa24faa0b7f8d31cd6f245a` |

## Reviewer fix round 1/5 — 2026-09-02

### RED evidence

Before production edits for this round, the focused behavioral command was:

```text
npm test -- src/features/github/components/github-check-presentation.test.ts src/features/github/components/github-collection-health-panel.test.tsx src/features/monitoring/components/member-monitoring.test.tsx src/app/app/monitoring/page.operator.test.tsx src/app/app/monitoring/page.member.test.tsx src/app/app/monitoring/monitoring-boundaries.test.tsx
```

Result: exit 1; 5 test files failed and 1 passed; 12 tests failed and 32 passed (44 total). The failures proved that active-but-permission-unhealthy GitHub installations were omitted from the system count, zero-coverage surfaces were positive green, the disconnected eyebrow remained connected, unhealthy/unavailable repository state did not dominate stale successful state, Owner checks lacked repository eligibility, other systems preceded findings, feedback was global/provider-worded, and the error boundary did not report its digest. The strengthened exact-title test passed because the implementation already contained all 15 reviewed issue titles.

The responsive RED command used local-only test records and did not click the GitHub check action:

```text
source =(npx supabase status -o env 2>/dev/null)
export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export PLAYWRIGHT_PORT=3100
export NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3100
npx playwright test e2e/github-shadow-collection.spec.ts --project=chromium
```

Result: exit 1; 1 test failed because the 390-pixel control-room step grid still computed as two columns. After the one-column rule was added, the same test reached the next new assertion and failed with a computed 40-pixel action minimum height instead of 44 pixels. Both failures were expected acceptance gaps.

A diagnostic attempt with `PLAYWRIGHT_PORT=3101` exited 1 before tests because Next correctly refused a second development server while the worktree server on port 3100 held its lock. No process was stopped or restarted; verification continued by reusing port 3100.

### Implemented reviewer corrections

- Active installation counting no longer depends on permission health; Member and operator paths both de-duplicate legacy GitHub sources.
- Zero-finding state is explicitly unconfirmed and neutral. Disconnected GitHub uses a neutral eyebrow; unavailable repositories and unhealthy installations show attention state ahead of any former successful run.
- Owner checks require at least one selected, available repository, with distinct no-selection and unavailable-only explanations.
- Other monitored systems now follow active findings and precede the closed technical review.
- The 390-pixel technical steps stack to one column, and the monitoring action is full width with a 44-pixel minimum height.
- Recheck results are stored beside each installation, provider/internal success wording is replaced with fixed plain language, failures remain safe, and refresh occurs only on success.
- The route error boundary posts only a supplied digest to `/api/observability`, catches reporting failure, and neither sends nor renders the provider error message.
- The presentation test now asserts the exact reviewed issue title for every one of the 15 bounded check IDs, including neutral attention wording for archived state.

### GREEN and final verification evidence

Immediate focused GREEN used the same six-file command as RED. Result: exit 0; 6 files and 44/44 tests passed.

Required ten-file regression command:

```text
npm test -- src/features/github/components/github-check-presentation.test.ts src/features/github/components/github-collection-health-panel.test.tsx src/features/github/components/github-compliance-control-room.test.tsx src/features/github/components/github-record-provenance.test.tsx src/features/monitoring/components/member-monitoring.test.tsx src/app/app/monitoring/page.operator.test.tsx src/app/app/monitoring/page.member.test.tsx src/app/app/monitoring/page.github-provenance.test.tsx src/app/app/monitoring/monitoring-boundaries.test.tsx src/features/github/components/github-monitoring-route-boundary.test.ts
```

Result: exit 0; 10 files and 67/67 tests passed.

Final static checks:

```text
npm run typecheck
npx eslint src/app/app/monitoring/page.tsx src/app/app/monitoring/loading.tsx src/app/app/monitoring/error.tsx src/app/app/monitoring/monitoring-boundaries.test.tsx src/app/app/monitoring/page.operator.test.tsx src/app/app/monitoring/page.member.test.tsx src/app/app/monitoring/page.github-provenance.test.tsx src/features/github/components/github-collection-health-panel.tsx src/features/github/components/github-collection-health-panel.test.tsx src/features/github/components/github-compliance-control-room.tsx src/features/github/components/github-compliance-control-room.test.tsx src/features/github/components/github-record-provenance.tsx src/features/github/components/github-record-provenance.test.tsx src/features/github/components/github-check-presentation.ts src/features/github/components/github-check-presentation.test.ts src/features/monitoring/components/member-monitoring.tsx src/features/monitoring/components/member-monitoring.test.tsx e2e/github-shadow-collection.spec.ts
git diff --check
```

Results: all exited 0; focused lint produced no warnings and diff-check found no whitespace errors.

Browser verification reused the existing local development server and the local Supabase stack with secret values suppressed. The Chromium command above exited 0 with 1 test passed, and the same command with `--project=mobile` exited 0 with 1 test passed. The browser flow exercised 1440, 1024, 801, and 390 pixels without invoking a live GitHub recheck or external provider request.

Files changed specifically in reviewer fix round 1/5:

- `e2e/github-shadow-collection.spec.ts`
- `src/app/app/monitoring/error.tsx`
- `src/app/app/monitoring/monitoring-boundaries.test.tsx`
- `src/app/app/monitoring/page.member.test.tsx`
- `src/app/app/monitoring/page.operator.test.tsx`
- `src/app/app/monitoring/page.tsx`
- `src/app/globals.css`
- `src/features/github/components/github-check-presentation.test.ts`
- `src/features/github/components/github-collection-health-panel.test.tsx`
- `src/features/github/components/github-collection-health-panel.tsx`
- `src/features/monitoring/components/member-monitoring.test.tsx`
- `src/features/monitoring/components/member-monitoring.tsx`

## Reviewer fix round 2/5 — 2026-09-02

### RED evidence

Before production edits, the focused unit/style command was:

```text
npm test -- src/features/github/components/github-collection-health-panel.test.tsx src/features/github/components/github-monitoring-route-boundary.test.ts src/app/app/monitoring/page.operator.test.tsx
```

Result: exit 1; 3 files ran, 3 tests failed and 18 passed (21 total). The failures proved that installation feedback followed the repository list, the Monitoring-only phone action contract did not exist, and the page lacked the dedicated wrapper/finding/other-system spacing classes.

The first browser setup placed the synthetic legacy finding before the existing axe scan and exited 1 on the pre-existing legacy finding metadata contrast. The fixture was moved after axe so this round did not suppress or alter accessibility coverage. The corrected browser RED command was:

```text
source =(npx supabase status -o env 2>/dev/null)
export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export PLAYWRIGHT_PORT=3100
export NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3100
npx playwright test e2e/github-shadow-collection.spec.ts --project=chromium
```

Result: exit 1 at the bounded 120-second test timeout while the new 390-pixel assertion waited for the missing `.monitoring-page` scope. No production file had been changed before these RED runs.

### Implemented reviewer corrections

- Both operator and Member render paths now have a `.monitoring-page` root, keeping the phone rules local to Monitoring.
- At 640 pixels or below, Monitoring action groups stack and every `.button` is full width with a 44-pixel minimum height; containing forms are also full width. This covers banner actions, legacy finding actions, GitHub finding actions, health actions, and expanded technical actions without changing buttons elsewhere.
- Each installation live region now appears immediately after its heading/action row and before configuration notes or the repository list. The two-installation DOM-order test verifies action → status → repository list independently for both cards.
- GitHub monitoring, active findings, other monitored systems, and technical review now use dedicated route-level spacing, while the finding and other-system cards carry stable regression classes.

### GREEN and final verification evidence

The focused unit/style command above exited 0 with 3 files and 21/21 tests passing.

Chromium initially observed the reused server's stale stylesheet, then a transient 42.x-pixel computed value while the existing 160ms link transition was in flight. The browser assertion now waits 250ms after the viewport transition before measuring the settled CSS. The same Chromium command then exited 0 with 1/1 test passing.

Required ten-file regression command:

```text
npm test -- src/features/github/components/github-check-presentation.test.ts src/features/github/components/github-collection-health-panel.test.tsx src/features/github/components/github-compliance-control-room.test.tsx src/features/github/components/github-record-provenance.test.tsx src/features/monitoring/components/member-monitoring.test.tsx src/app/app/monitoring/page.operator.test.tsx src/app/app/monitoring/page.member.test.tsx src/app/app/monitoring/page.github-provenance.test.tsx src/app/app/monitoring/monitoring-boundaries.test.tsx src/features/github/components/github-monitoring-route-boundary.test.ts
```

Result: exit 0; 10 files and 68/68 tests passed.

Final static checks:

```text
npm run typecheck
npx eslint src/app/app/monitoring/page.tsx src/app/app/monitoring/loading.tsx src/app/app/monitoring/error.tsx src/app/app/monitoring/monitoring-boundaries.test.tsx src/app/app/monitoring/page.operator.test.tsx src/app/app/monitoring/page.member.test.tsx src/app/app/monitoring/page.github-provenance.test.tsx src/features/github/components/github-collection-health-panel.tsx src/features/github/components/github-collection-health-panel.test.tsx src/features/github/components/github-compliance-control-room.tsx src/features/github/components/github-compliance-control-room.test.tsx src/features/github/components/github-record-provenance.tsx src/features/github/components/github-record-provenance.test.tsx src/features/github/components/github-check-presentation.ts src/features/github/components/github-check-presentation.test.ts src/features/monitoring/components/member-monitoring.tsx src/features/monitoring/components/member-monitoring.test.tsx src/features/github/components/github-monitoring-route-boundary.test.ts e2e/github-shadow-collection.spec.ts
git diff --check
```

Results: typecheck, focused lint, and diff-check all exited 0 with no lint output or whitespace errors. Mobile/Pixel 5 ran the same local-only E2E flow and exited 0 with 1/1 test passing. The browser tests inserted only a synthetic local legacy finding and synthetic DOM presentation fixture; they never clicked `Check GitHub now` or contacted GitHub.

Files changed specifically in reviewer fix round 2/5:

- `e2e/github-shadow-collection.spec.ts`
- `src/app/app/monitoring/page.operator.test.tsx`
- `src/app/app/monitoring/page.tsx`
- `src/app/globals.css`
- `src/features/github/components/github-collection-health-panel.test.tsx`
- `src/features/github/components/github-collection-health-panel.tsx`
- `src/features/github/components/github-monitoring-route-boundary.test.ts`
- `src/features/monitoring/components/member-monitoring.tsx`

## Reviewer fix round 3/5 — 2026-09-02

### RED evidence

The browser test now creates 41 synthetic local repositories, selects them locally, opens Monitoring page 2, expands the technical review, and verifies both pagination links at 390 pixels. An initial fixture attempt through the service client exited 1 with PostgreSQL `42501 permission denied for table github_repositories`; this was fixture setup rather than the target behavior. The test was corrected to use the existing bounded local-Docker pattern after validating the organisation and installation UUIDs.

No production file had been edited when the corrected RED command ran:

```text
source =(npx supabase status -o env 2>/dev/null)
export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export PLAYWRIGHT_PORT=3100
export NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3100
npx playwright test e2e/github-shadow-collection.spec.ts --project=chromium
```

Result: exit 1; 1 test failed. At 390 pixels, `.github-control-room-pagination` exposed two computed 160-pixel columns instead of one. Both `Previous repositories` and `Next repositories` were present on page 2, so the failure exercised the reported state without a GitHub request.

### Minimal implementation

Only the phone pagination CSS changed. At 640 pixels or below, the page label occupies the first row and each available repository pagination link occupies its own single-column row, stretches to full width, and has a 44-pixel minimum height. The anchors retain native `href` behavior and visible focus styling.

### GREEN and final verification evidence

The first post-change browser run still read the development server's stylesheet from 21:46 while the source was from 21:56 and repeated the two-column failure. After the selector was scoped to `.monitoring-page` and the compiled asset timestamp/content was verified, the same Chromium command exited 0 with 1/1 test passing. It checked both link widths, both 44-pixel minimum heights, and programmatic keyboard focus.

Required regression/static commands:

```text
npm test -- src/features/github/components/github-check-presentation.test.ts src/features/github/components/github-collection-health-panel.test.tsx src/features/github/components/github-compliance-control-room.test.tsx src/features/github/components/github-record-provenance.test.tsx src/features/monitoring/components/member-monitoring.test.tsx src/app/app/monitoring/page.operator.test.tsx src/app/app/monitoring/page.member.test.tsx src/app/app/monitoring/page.github-provenance.test.tsx src/app/app/monitoring/monitoring-boundaries.test.tsx src/features/github/components/github-monitoring-route-boundary.test.ts
npm run typecheck
npx eslint src/app/app/monitoring/page.tsx src/app/app/monitoring/loading.tsx src/app/app/monitoring/error.tsx src/app/app/monitoring/monitoring-boundaries.test.tsx src/app/app/monitoring/page.operator.test.tsx src/app/app/monitoring/page.member.test.tsx src/app/app/monitoring/page.github-provenance.test.tsx src/features/github/components/github-collection-health-panel.tsx src/features/github/components/github-collection-health-panel.test.tsx src/features/github/components/github-compliance-control-room.tsx src/features/github/components/github-compliance-control-room.test.tsx src/features/github/components/github-record-provenance.tsx src/features/github/components/github-record-provenance.test.tsx src/features/github/components/github-check-presentation.ts src/features/github/components/github-check-presentation.test.ts src/features/monitoring/components/member-monitoring.tsx src/features/monitoring/components/member-monitoring.test.tsx src/features/github/components/github-monitoring-route-boundary.test.ts e2e/github-shadow-collection.spec.ts
git diff --check
```

Results: exit 0; 10 focused files and 68/68 tests passed; typecheck, focused lint, and diff-check also exited 0. Desktop Chromium exited 0 with 1/1 test passing. A mobile run had also completed 1/1 before the subsequent scope update directed that no further mobile verification be performed; it was not rerun. No test clicked the GitHub check action or contacted GitHub.

Files changed specifically in reviewer fix round 3/5:

- `e2e/github-shadow-collection.spec.ts`
- `src/app/globals.css`

## Concerns

- The worktree remains intentionally dirty/untracked from prior Phase 1 work. No commit was created.
- The browser test mutates only synthetic records in the local Supabase test stack; it does not clean them up and does not contact GitHub.
- The Next build emits the existing Turbopack root warning described above.
