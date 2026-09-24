# Monitoring readability — local review, 24 September 2026

This branch simplifies the GitHub part of Monitoring for an Owner, CISO or nontechnical teammate. It does not change GitHub collection, mapping approval, evidence creation, finding lifecycle, permissions or AWS configuration.

## What changed

- The Monitoring summary counts only results backed by a healthy repository connection, a successful collection, completed processing for that same collection, a complete check set and the currently published Owner-approved mapping. Older or unverifiable saved results are labelled for review, not presented as current passes. Counts explicitly apply to the loaded repository page.
- A finding leads with the issue, recommended action, where to verify it and dates. Its check ID, rule/mapping versions and checksum remain available under **Audit details → Internal identifiers**.
- The optional 15-check catalogue uses one readable list with names, severity if failed, ISO references and suggested action. Raw rule text is under **Rule details**. Workflow steps and the mapping checksum are also collapsed by default.
- Saved results use plain labels and local-time dates. A historical pass or issue does not look like a fresh verified result. Evidence and finding links remain available.

## Visual evidence

These are isolated renderings of the actual React components with the production CSS and **fictional local data**. They are not a screenshot of an authenticated workspace, live GitHub result or AWS release. Compare with the four owner-provided 24 September screenshots of the previous dense technical panels.

| View | New rendering |
| --- | --- |
| Technical review entry, with workflow and checksum folded away | [Top](2026-09-24-monitoring-clarity/top.png) |
| One-column check definitions, with rule IDs folded away | [Checks](2026-09-24-monitoring-clarity/checks.png) |
| Saved result status, date and record link | [Results](2026-09-24-monitoring-clarity/results.png) |
| Finding action and plain audit history | [Finding](2026-09-24-monitoring-clarity/finding.png) |

## Verification and limits

Fresh local focused component/page/domain tests (46 assertions after the final layout change), TypeScript, lint and the production build passed. An earlier full unit run, before the final presentational layout change, passed 3,436 assertions with three skipped. Independent Sol review identified three misleading or inaccessible labels; each was corrected and re-reviewed with no material remaining finding in those paths.

Two subsequent full-suite attempts were **not completed**: one parallel run saw a timing-sensitive, unrelated GitHub reconcile test fail before the resource guard stopped; that focused test then passed twice alone (22/22 each time). A single-worker full run was also stopped when the local resource monitor failed under Mac load. Neither stopped run is a green full-suite result for the final layout. No unrelated GitHub code was changed to mask it.

The production build on `http://127.0.0.1:3600` reported `status: ok`, `db: ok` and the feature-branch source identity. However, this Mac currently uses Docker Desktop rather than the demo launcher's expected Colima context, and the running local database has 45 unapplied migrations, including the GitHub results tables. An old fictional showcase login is absent. The authenticated Monitoring route was **not** demonstrated here; the screenshots above are component previews only. No existing local database was reset or migrated, and no AWS deployment or live-provider verification occurred.

The next operational step is to update or isolate the local test database, then run an authenticated Owner/Member Monitoring walkthrough before considering an AWS dev deployment.
