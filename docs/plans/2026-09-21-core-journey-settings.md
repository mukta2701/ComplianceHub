# Core Journey and Settings Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make ComplianceHub's first-use roadmap, account context, notifications and optional settings coherent while preserving existing compliance records and paused GitHub work.

**Architecture:** Keep authorization and workspace mutations in the existing organisations and SoA application modules. Pass a narrow RLS-scoped account display model from the protected layout into the client shell; keep sound preference browser-local and leave AI enablement data unchanged.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Supabase SSR/RLS, Vitest/Testing Library, Playwright.

---

### Task 1: Enforce assessment and SoA creation permissions

**Files:**
- Modify: `src/features/soa/application/actions.ts`
- Test: `src/features/soa/application/actions.access.test.ts`

1. Write failing tests showing a Member cannot call `createAssessmentAction`, `createSoaAction` or `createSoaSuccessorAction`, while an Owner/Admin keeps the existing path.
2. Run the focused test and confirm it fails because the actions lack the role decision.
3. After `requireAppContext()`, use `workspaceAccess(membership.role).section("assessments" | "soa").canManage` and throw the existing safe authorization error before any write.
4. Run focused SoA action and workspace-access tests.
5. Commit only the authorization change and tests.

### Task 2: Make the first-use roadmap truthful

**Files:**
- Modify: `src/features/onboarding/domain/checklist.ts`
- Modify: `src/features/onboarding/domain/checklist.test.ts`
- Modify: `src/app/app/page.tsx`
- Test: `src/app/app/page.test.tsx` or the nearest dashboard test

1. Write failing domain tests for the exact labels `Start your first readiness assessment`, `Create your first policy`, and `Invite a teammate`, plus new asset and task steps.
2. Extend `OnboardingInputs` with `hasAsset` and `hasTask`; keep completion based on facts already available.
3. Add RLS-scoped asset and task count queries to the dashboard and pass them to the checklist.
4. Run the focused checklist/dashboard tests and confirm the new ten-step sequence and roll-up.
5. Commit the roadmap change.

### Task 3: Add an account and workspace menu with opt-in alert sound

**Files:**
- Modify: `src/app/app/layout.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/app-shell.module.css`
- Modify: `src/components/app-shell.test.tsx`
- Modify: `src/components/alert-toaster.tsx`
- Modify: `src/components/alert-toaster.test.tsx`
- Create: `src/components/notification-sound-preference.ts`
- Test: `src/components/notification-sound-preference.test.ts`

1. Write failing tests for an accessible `Account menu` button, visible display name/email/role/workspace, one form per alternate workspace using `switchWorkspaceAction`, and sign-out.
2. Write failing pure tests for a browser-local sound preference whose default is off and whose storage key is stable.
3. Write a failing toaster test proving initial history is silent and one newly arriving alert requests one sound only when enabled.
4. Load the current user's RLS-scoped memberships in the protected layout and pass a narrow `{ id, name, role }[]` model plus display name/email.
5. Implement the menu with native `details/summary`, workspace forms, notification link, sound toggle/test and sign-out. Keep keyboard labels and focus behavior native.
6. Implement a short Web Audio tone only after explicit user interaction has enabled sound; failures stay silent and never block the toast.
7. Run focused shell, workspace-action and toaster tests.
8. Commit the account and notification change.

### Task 4: Consolidate optional Settings surfaces

**Files:**
- Modify: `src/app/app/settings/page.tsx`
- Modify: `src/app/app/settings/settings-sections.tsx`
- Modify: `src/app/app/settings/settings-sections.test.tsx`
- Modify: `src/app/app/settings/connected-applications.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/app-shell.test.tsx`

1. Write failing tests showing Settings no longer exposes an `AI assistance` section, Connected Assistants describes company Codex without claiming Claude availability, and Customer trust links to `/app/trust`.
2. Remove only the AI settings presentation and query from Settings. Preserve the existing AI setting, actions and protected readers.
3. Add a Customer trust Settings section explaining the safe public summary and linking to its existing management page.
4. Remove Trust Center from primary sidebar navigation while retaining route title/access policy.
5. Run focused Settings, connected-applications, trust-access and shell tests.
6. Commit the Settings cleanup.

### Task 5: Integrated verification and evidence

**Files:**
- Modify: `docs/release-checklist.md`
- Create/update: `docs/evidence/2026-09-21-core-journey-settings.md`

1. Run lint, type checking, relevant unit tests, the full unit suite and production build sequentially under `scripts/local-resource-guard.ts`.
2. Build and start the production preview using the supported local scripts; verify exact source identity, HTTP health and database health.
3. Use fictional local data to exercise account context, the first-use roadmap, asset CSV/XLSX import/export, one risk/task/evidence path, assessment/SoA handoff, Trust Center management and leadership report. Keep provider-dependent Monitoring explicitly unavailable where no provider exists.
4. Capture comparable desktop/mobile screenshots and a short before/after interaction recording if the available browser tooling supports it.
5. Record exact fresh evidence and limits in the existing release checklist and one linked evidence file.
6. Run the diff cleanup and independent spec, technical and product review gates; fix findings and rerun affected checks.
7. Commit and push `codex/core-journey-settings` to the existing origin. Do not merge or deploy.

