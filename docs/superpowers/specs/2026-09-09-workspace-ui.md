# Workspace navigation and Settings design

Starting commit: `c4b2d2434593189ff68b46bd7f7e34784f00efdf`.

The owner explicitly requested a visual reorganisation and Mobbin references. This supersedes the earlier deferral of broad visual work for this bounded increment; it does not change product scope or permissions.

## Observed problem and direction

At the actual 883px browser width, the old global sidebar and Settings sidebar consume approximately 456px before content padding. Team names stack into narrow columns and editing forms crowd the remaining space. Across workspace pages, small table text and competing card treatments weaken hierarchy. A translated closed drawer also remains keyboard-reachable in the earlier shell.

Use a restrained neutral canvas, existing blue actions and semantic status colours, grouped workspace navigation, clearer headings and 14px work text / 12px metadata. Settings shows one subject at a time using hash-addressable horizontal links and compact member rows; authorised editing is revealed deliberately. Keep account, review and evidence meaning unchanged.

References inspected in the browser, not copied into the product:
- [Linear work list on Mobbin](https://mobbin.com/screens/94bb4d3b-a8e3-41e8-b8f1-b82d1f904b03): muted navigation, grouped flat rows and secondary configuration.
- [Linear onboarding preferences on Mobbin](https://mobbin.com/screens/826b126d-ef34-4f69-85b0-54ecc26df03c): one focused subject with aligned descriptive rows; inspected after the owner asked for broader consistency.
- [Sentry issue list on Mobbin](https://mobbin.com/screens/92525937-e703-4e62-bd8a-2b6bcb7ca627): clear title, aligned filters and restrained table hierarchy.
- [Linear settings/navigation announcement](https://linear.app/changelog/2024-12-18-personalized-sidebar): grouped settings and focused management. Reference screenshots are not redistributed.

## Acceptance

1. Operator navigation groups existing routes by Work, Programme, Oversight, Share and Admin. Asset inventory is discoverable. Member navigation remains restricted to its existing curated routes; navigation visibility is not an authorisation boundary.
2. At widths up to 1024px, navigation becomes a closed drawer without reserving sidebar width. Opening isolates background interaction and contains keyboard focus; Escape and overlay close restore the opener. Desktop resizing removes modal behaviour and returning to mobile starts closed. A skip link reaches page content.
3. Shared workspace headings, actions, forms and existing tables have consistent spacing, readable labels and preserved status colours. Public pages retain their presentation. Tables may scroll inside their existing labelled keyboard-accessible regions, but the page must not overflow horizontally at 1440px, 883px or 393px on demonstrated routes.
4. Settings has Workspace, Team members, Security, AI assistance and Connected assistants sections. Direct hashes, reload, back/forward and legacy `#invites` work. Invitation returns select Team. Section changes preserve mounted forms.
5. Authorised member controls remain functional inside Edit details. Demonstrate a job-title edit saved and retained after reload in a new fictional local workspace. Preserve existing role/action checks and do not send invitations or alter existing records for the demo.
6. Show actual production desktop/mobile Settings and representative dashboard, tasks, risks, evidence and policies screens. Check focus and serious/critical automated accessibility findings on affected interfaces. Automated accessibility scanning supplements manual visual/keyboard checks.
During the required accessibility scan, dashboard metadata contrast and the Risk register status selector label were identified as missing. Correct these shared-use interface details without changing risk transitions.

7. Existing component/action tests, full unit checks, typecheck, lint and build pass. Independent standards and specification reviews resolve material findings before commit/push and background preview replacement.

## Verification boundaries

Use existing rendered-component and Playwright browser seams under the local resource guard, one heavy command at a time. Local API must be 55321. Record useful before/after fictional screenshots, actual checks and limitations. This batch does not change database permissions, provider operation, review semantics or hosted state. Deeper individual module redesigns and hosted/human acceptance remain subsequent work. The release checklist remains the overall status source.
