# Monitoring clarity implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make GitHub Monitoring readable to non-technical reviewers without losing audit traceability or changing check behavior.

**Architecture:** Keep existing server-loaded results and client components. Derive display labels from each result's `freshUntil` and the room's `asOf` time, while leaving stored outcomes unchanged. Move internal identifiers below a second disclosure and make summary and finding copy distinguish saved findings from current provider state.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, existing CSS and UI components.

---

### Task 1: Make result freshness honest

**Files:** `src/features/github/components/github-compliance-control-room.tsx`, `src/features/github/components/github-compliance-control-room.test.tsx`, `src/app/app/monitoring/page.tsx`, `src/app/app/monitoring/page.github-provenance.test.tsx`.

1. Add failing tests for fresh versus expired passes and failures using a fixed `room.asOf`. Assert expired results never show `Verified technical pass` or a current issue label, and links to evidence/findings still work.
2. Run `node --import=tsx scripts/local-resource-guard.ts -- npm test -- --maxWorkers=1 src/features/github/components/github-compliance-control-room.test.tsx src/app/app/monitoring/page.github-provenance.test.tsx`. Confirm the new assertions fail.
3. Add one display-only freshness function. Keep outcome, stored record, links and role checks unchanged. Replace raw result summaries and ISO dates in the visible row with a title, honest status, human-readable observation time and link. Make the page summary and findings subtitle say when saved results need rechecking.
4. Rerun the focused tests. Commit the coherent source and test change.

### Task 2: Make audit detail readable

**Files:** `src/features/github/components/github-record-provenance.tsx`, `src/features/github/components/github-record-provenance.test.tsx`, `src/features/github/components/github-compliance-control-room.tsx`, `src/features/github/components/github-compliance-control-room.test.tsx`, `src/app/globals.css` if styling needs a small adjustment.

1. Add failing tests that the finding says `Audit details`, shows when it was observed, and hides internal IDs and checksums in nested `Internal identifiers`. Assert the mapping and result disclosures retain all 15 exact records but lead with plain titles and actions.
2. Run the two focused component tests and confirm the new assertions fail.
3. Replace the repeated check-ID prose in the visible catalogue/result rows with plain descriptions. Keep exact check IDs, versions, checksum, ISO references and approval actions accessible under audit disclosures. Do not remove provenance or human-review boundaries.
4. Rerun focused tests and commit.

### Task 3: Verify local product behavior

**Files:** `docs/release-checklist.md` and a dated evidence note only if fresh verification changes their status.

1. Run focused tests, typecheck, lint and a guarded production build sequentially. Fix affected failures without changing unrelated features.
2. Run the local production preview against the supported local environment. Check HTTP/database health and the actual Monitoring page. Capture before (owner's AWS screenshots) and after local screenshots, including a stale result and expanded audit details. Do not use fictional local data as proof of AWS/provider behavior.
3. Review the final diff for truthful status labels, preserved role permissions and links. Keep the preview available for owner review. Update release checklist only with verified facts, then commit and push the feature branch. Do not merge or deploy to AWS in this task.
