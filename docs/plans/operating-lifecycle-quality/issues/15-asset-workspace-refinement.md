# 15: Asset workspace refinement

**Starting commit:** `6fb6a9166d38969fa9de8d0886abfda45a82d078`

**What to build:** A coherent, truthful Asset inventory → detail → create/edit → linked risk journey, including reliable existing imports and complete CSV/XLSX exports, as described in the [asset workspace specification](../../../superpowers/specs/2026-09-10-asset-workspace-refinement.md).

**Blocked by:** None.

**Status:** verified-locally

- [x] Inventory gives desktop/mobile users equivalent reference, description, category, accountable owner, classification, criticality and detail navigation. Counts cover their stated population; any display cap is explicit.
- [x] Detail separates recorded metadata, descriptive Owner & Location, actual in-app ownership and linked risks. Missing data is explicit and no recorded field implies human review or provider verification.
- [x] Material asset, option and relationship read failures remain unavailable rather than becoming empty lists, unassigned ownership, defaults, broken links or false 404s.
- [x] Shared create/edit forms retain existing fields and validation, preserve drafts after failures, provide associated errors and pending feedback, and retain valid selected owners/categories beyond the ordinary option page.
- [x] Atomic stale-edit protection rejects older drafts without changing the newer record or losing user input, including relevant assignment/category removal and refresh cases. The user-entered Last Updated date remains separate from the edit version.
- [x] Linking/unlinking a risk refreshes both sides and supports working reciprocal navigation. Metadata changes refresh inventory and detail; existing delete and role boundaries remain intact.
- [x] Import categories resolve completely or produce an accurate safe failure/skipped row. No requested category silently becomes blank. Sparse workspace references and explicit batch references are respected when allocating missing references.
- [x] Explicit In-app owner resolution, descriptive location, additive imports, preview invalidation and confirmation-time checks remain intact; partial outcomes are accurate. Other import types retain their behaviour if shared helpers change.
- [x] CSV and XLSX exports contain all existing-contract rows beyond one database response, remain workspace scoped and fail clearly when a required page fails. Existing export protections/audit behaviour and relationship-roundtrip limitations remain explicit.
- [x] Owner/Admin management and existing Member request-level denials pass relevant action, integration and database checks; no unauthorised mutation, export or cross-workspace access is introduced.
- [x] Fictional local production-browser acceptance demonstrates create/read/edit/stale-edit, linked-risk navigation/unlink, import and export. Desktop, tablet and mobile inspection plus keyboard/accessibility checks demonstrate the updated screens.
- [x] Appropriate focused/full checks and independent standards/specification reviews pass; material findings are resolved. Evidence distinguishes local behaviour from live-provider and hosted/human acceptance.
- [x] Verified source and sanitised evidence are committed and pushed; the local review app runs the verified build and the release checklist reflects only demonstrated facts.

Direct asset tasks/evidence, discovery, recurring review schedules and relationship roundtrip remain deferred; they are not implicit acceptance criteria for this increment.
