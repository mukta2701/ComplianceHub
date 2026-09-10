# Task 5 report — polished Controls & applicability workspace

## Status

Task 5 is implemented and verified locally with fictional data in the shared `codex/team-baseline` worktree. The production build and the complete six-test connected browser journey pass. The local Task 5 commit is recorded after this report is staged.

This task does not change control-review persistence, finalisation rules, exports, deployment, live-provider behavior, or the release checklist. Two integration defects found by the journey were fixed in the Task 3 and Task 4 commits already present on the branch; the narrow Member portal correction belongs to this Task 5 change.

## User-visible outcome

- The Controls & applicability landing page presents the programme path from current assessment through active review to an immutable formal Statement of Applicability.
- Active editable reviews and finalised statements have separate sections, states and actions. Owners and Admins can start or safely reuse a review; Members can open the landing and strict UUID detail routes in read-only mode and receive no creation or save action.
- The populated review identifies the source assessment, displayed revision, register version, last activity and formal-output state. Incomplete assessment context remains explicitly provisional.
- One accessible reviewed/total progress bar is labelled as review progress rather than certification or effectiveness. Exact attention counts remain separate because their populations can overlap.
- Queue rows expose control identity and domain, mapped/unmapped source context, review state, applicability and implementation status, owner, evidence/rationale summary, and the next attention reason.
- The selected control displays the traceable chain from assessment context through decision, accountability, evidence and linked work. Every mapped source answer includes its question code, prompt, answer, supporting note and update time; null answers and unmapped controls are explicit.
- Existing Decision, Evidence, Linked work and History tabs, protected saves, stale-draft feedback, role boundaries and exact finalisation blockers remain intact.
- Named stylesheet rules provide desktop, tablet and mobile layouts, visible focus and 44px mobile actions without page-level inline style clusters.

## TDD evidence

### RED

- Initial focused Task 5 run: 4 intended failures and 52 passes. The landing lacked the programme/formal-output distinction, and the populated workspace lacked mapped/null/unmapped source context, a labelled progress graphic and the visible decision chain.
- Assessment integration regression: 2 intended failures and 19 passes. Both assessment pages still used the ambiguous `soa_snapshots(id)` PostgREST embed after the schema gained both the legacy register FK and tenant-composite FK.
- Member portal regression: 4 intended failures and 42 passes. The settled product rule allowed Members to read controls, but the portal allowlist and Member navigation omitted the landing and register detail.

### GREEN

- Focused Task 5 component run: 4 files and 82 tests passed.
- Broader control-review run: 11 files and 157 tests passed.
- Assessment relationship regression: 21 of 21 tests passed after the two affected queries selected `soa_snapshots!soa_snapshots_register_tenant_fk(id)`.
- Member portal and shell regression: exact landing and UUID detail access pass; import, invalid and nested SoA paths remain denied; existing portal routes are unchanged; the Member navigation is visible. The affected five-file run passed 110 of 110 tests.
- Final combined Task 5 regression run: 15 files and 239 tests passed.

## Integration defects found during the fictional browser journey

The first production-browser handoff exposed PostgREST error `PGRST201`: assessment register/detail queries could no longer infer which `soa_registers` to `soa_snapshots` relationship to embed. Schema and generated-type inspection confirmed the legacy single-column FK and the tenant-composite `soa_snapshots_register_tenant_fk`. The two ambiguous assessment queries now name the tenant-composite relationship explicitly. Focused tests assert the exact qualified select while retaining organisation filters, counts and caps.

A later browser run exposed an existing 93-control loader hot path with per-item audit, task and head reads. The grouped loader correction in Task 4 commit `dc4e5bb` reduced observed requests from 111/295/108 to 18/18/17, with four requests for a finalised statement. The integrated correction made the register and post-save render complete within the normal browser budget.

The guarded stale-save journey then isolated SQLSTATE `40001`, which the local Supabase/PostgREST path treated as retryable: a direct stale call took 60,017ms and ended in a gateway timeout. Task 3 commit `dafd61f` maps the public conflict to `PT409`; direct authenticated REST returned HTTP 409/PT409 in 46ms with zero writes. The final browser conflict test passed in 2.4 seconds and retained the unsaved rationale with refresh guidance.

Finally, the Member browser journey showed that portal middleware denied the Controls route before the established read-only workspace could render. This Task 5 change allows only `/app/soa` and `/app/soa/{strict UUID}` for Members, exposes the Controls & applicability navigation item, and continues to deny `/app/soa/import`, invalid identifiers and nested suffixes. The page and action controls remain read-only.

## Fresh verification

- Vitest: 15 files and 239 tests passed in 12.77 seconds across SoA domain/application/actions/pages, assessment relationship regressions, portal access and the app shell.
- ESLint: full repository lint passed.
- TypeScript: `tsc --noEmit` passed.
- Next.js 16.3 production build: passed, including all `/app/soa` routes.
- Playwright against the standalone production server: 6 of 6 Chromium tests passed in 18.6 seconds under the normal per-test timeout. Individual tests completed in 2.3s, 3.8s, 2.4s, 1.4s, 4.4s and 2.2s.
- Browser assertions cover assessment-to-register context, protected save feedback, stable stale-write conflict behavior, active/formal separation, Member read-only access, horizontal overflow at 1440/1024/390, intended sticky/static positioning, and zero serious or critical axe findings.

## Visual inspection and limits

Viewport screenshots are 1440×1000, 1024×1000 and 390×844. Bounded workspace screenshots are 1136×894, 976×1419 and 358×1932. They show the intended two-column sticky desktop workspace, unstuck stacked tablet layout, and single-column mobile flow with full-width actions and no clipping.

Earlier Playwright `fullPage` captures were 15,187–16,551px tall even though measured `body`/`main` content was only about 1,915/1,785px at 1440, 2,671/2,541px at 1024 and 3,993/3,853px at 390. Chromium included the 93-row internally scrollable queue in the root capture height and produced a blank tail. This was a screenshot artifact rather than a page-height CSS defect. Final evidence uses a normal viewport capture plus a bounded `.soa-review-layout` capture at each width.

The browser and screenshots use local fictional data. They do not prove hosted behavior, provider behavior, certification or control effectiveness. Browser teardown can log `The destination stream closed early` when Playwright closes a page while a background `router.refresh()` response is finishing; all user-visible save and conflict assertions completed before teardown.

## Self-review and boundaries

- Source answers remain current assessment context and do not mutate applicability, implementation status or immutable output.
- Finalised statement views bypass the editable workspace and do not display current assessment answers.
- Member editing and creation controls remain absent; operator actions reuse the existing server actions and guarded persistence.
- Queue review state, applicability, implementation status, evidence freshness and task state remain separate fields and labels.
- Required reads retain exact counts and caps; displayed list-limit messages do not turn partial optional context into complete results.
- Finalisation copy uses the existing preflight calculation, including catalogue total, pending decisions, rationale, owner, live-evidence and stored-expired-evidence blockers.
- The strict Member route change does not grant access to import or arbitrary SoA suffixes.

## Files

- `src/app/app/soa/page.tsx`
- `src/app/app/soa/page.scope.test.tsx`
- `src/app/app/soa/[id]/page.tsx`
- `src/app/app/soa/[id]/page.test.tsx`
- `src/app/app/soa/[id]/soa-review-workspace.tsx`
- `src/app/app/soa/[id]/soa-review-workspace.test.tsx`
- `src/features/soa/application/review-queue.ts`
- `src/app/globals.css`
- `e2e/connected-controls.spec.ts`
- `src/app/app/assessment/page.tsx`
- `src/app/app/assessment/page.test.tsx`
- `src/app/app/assessment/[id]/page.tsx`
- `src/app/app/assessment/[id]/page.completion.test.tsx`
- `src/features/organisations/domain/portal-access.ts`
- `src/features/organisations/domain/portal-access.test.ts`
- `src/components/app-shell.tsx`
- `src/components/app-shell.test.tsx`

The release checklist was intentionally not updated for this delegated task.

## Product review corrections after `e78123b`

A focused product-code review found five boundary and scale issues, now corrected without changing the database schema or browser test file.

- `finaliseSoaAction` explicitly rejects Members with the stable operator-only message before parsing, rate limiting, data reads or the finalisation RPC. The authoritative `20260901000000` database function already checks `is_organisation_operator`; no duplicate migration was added.
- Member pages retain their existing read boundary. Members can open active and finalised statements, but the landing XLSX/CSV links and finalised PDF/DOCX links are absent. The read-only copy no longer promises downloads.
- Each operator source option now states the assessment state, revision, complete answered/question count and assessment catalogue. The nearby limitation says incomplete answers provide current context and never decide applicability.
- Landing reads now display at most 50 recent assessments, registers and statements while retaining exact totals when more exist. A count larger than the displayed rows no longer hides the page. Displayed registers are classified with `soa_snapshots!soa_snapshots_register_tenant_fk(id)`, and cap notes point operators back to the assessment register or source assessment for older records.
- Complete bounded catalogue-question and assessment-response reads are required before enabling review creation. If those supporting counts cannot be verified, creation is withheld while the existing review and statement histories remain readable.

Review-fix TDD RED was 6 intended failures with 35 passes: Member finalisation reached the RPC, Member exports remained visible, source choices lacked provenance/progress, and oversized landing histories were treated as unavailable. Focused GREEN is 43 of 43 tests. The broader fresh regression passed 243 of 243 tests across 15 files in 12.37 seconds. Full ESLint, `tsc --noEmit`, and the Next.js 16.3 production build also pass. Browser updates and reruns are handled separately and are not evidence for this product-only correction yet.
