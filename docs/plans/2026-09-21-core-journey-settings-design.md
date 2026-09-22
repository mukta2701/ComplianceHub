# Core journey and settings cleanup design

Date: 21 September 2026  
Status: Approved for implementation

## Outcome

Make the existing ComplianceHub product easier to enter and understand without redesigning its registers or resuming GitHub provider work. A new operator should see an honest sequence from workspace setup to a reviewable leadership position, understand which workspace and role they are using, and find optional customer-sharing and assistant connections in Settings rather than among the primary compliance records.

## Product direction

ComplianceHub remains a trust-first operational workspace for a startup with 20 or more employees. The interface stays restrained and information-dense: low motion, clear status language and progressive disclosure. It borrows Vanta and Drata's connected-record logic, not their branding.

The first useful journey is:

**Scope → assessment → controls → assets and risks → assigned work → evidence → leadership report → reassessment.**

Record creation is not completion. A draft assessment is started, not run; an invitation is sent, not accepted; a draft policy is created, not published. The dashboard must use labels that match the facts it actually queries.

## Changes

1. Add missing server-side role checks to assessment and Statement of Applicability creation actions. Hidden buttons are not authorization.
2. Make the dashboard checklist truthful and add asset and task milestones. Use existing record counts; do not add schema or pretend that record existence proves human review.
3. Replace the static top-right initials with an accessible account menu showing the signed-in person, role and active workspace. Reuse the existing tenant-checked workspace switch action when the person belongs to more than one workspace.
4. Put an opt-in notification-sound preference in that menu. Store it in the browser, play only for alerts that arrive after the page is open, and include a test control. Initial history and page reloads remain silent.
5. Remove the separate AI-assistance Settings navigation surface. Do not delete data or silently change stored enablement. Describe Connected Assistants as the future company Codex connection and keep it read-only under current permissions.
6. Remove Trust Center from primary navigation and add a Settings entry explaining that it is an optional customer-facing summary, off by default, with an explicit management link.

## Technical shape

The existing organisation-domain workspace action remains the workspace-switch interface. The protected layout loads only the current user's RLS-scoped memberships and passes a small display model to `AppShell`. The shell owns only local menu and sound-preference interaction; database mutations stay in authenticated Server Actions.

No migration is required. The AI database setting remains intact because removing a confusing control is separate from changing AI authorization or provider configuration. A later milestone may replace that stored setting with a build-level capability after all readers are reconciled.

## Verification

- Focused tests prove role denial, checklist semantics, account-menu rendering and workspace switch forms, silent initial alert loading, opt-in sound, consolidated Settings, and Trust Center placement.
- Lint, type checking, unit tests and production build run sequentially under the local resource guard.
- A production preview demonstrates the affected Owner journey with fictional local data. Admin and Member presentation are checked through existing access tests and a local browser journey where available.
- GitHub provider setup, live provider rechecks, deployment and human acceptance remain outside this slice.

