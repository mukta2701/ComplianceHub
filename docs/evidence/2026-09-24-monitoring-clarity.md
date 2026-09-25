# Monitoring readability — local review and AWS dev release, 24 September 2026

This branch simplifies the GitHub part of Monitoring for an Owner, CISO or nontechnical teammate. It does not change GitHub collection, mapping approval, evidence creation, finding lifecycle, permissions or AWS configuration.

## What changed

- The Monitoring summary counts only results backed by a healthy repository connection, a successful collection, completed processing for that same collection, a complete check set and the currently published Owner-approved mapping. Older or unverifiable saved results are labelled for review, not presented as current passes. Counts explicitly apply to the loaded repository page.
- A finding leads with the issue, recommended action, where to verify it and dates. Its check ID, rule/mapping versions and checksum remain available under **Audit details → Internal identifiers**.
- The optional 15-check catalogue uses one readable list with names, severity if failed, ISO references and suggested action. Raw rule text is under **Rule details**. Workflow steps and the mapping checksum are also collapsed by default.
- Saved results use plain labels and local-time dates. A historical pass or issue does not look like a fresh verified result. Evidence and finding links remain available.
- The Monitoring reader accepts the current local database's two additional result labels without dropping into a generic error. A successful repository collection is labelled "Last check completed" rather than the misleading "Up to date"; that badge does not claim its saved compliance result is current.

## Visual evidence

The first four images are isolated renderings of the actual React components with the production CSS and **fictional local data**. They are not screenshots of an authenticated workspace, live GitHub result or AWS release. Compare them with the four owner-provided 24 September screenshots of the previous dense technical panels.

| View | New rendering |
| --- | --- |
| Technical review entry, with workflow and checksum folded away | [Top](2026-09-24-monitoring-clarity/top.png) |
| One-column check definitions, with rule IDs folded away | [Checks](2026-09-24-monitoring-clarity/checks.png) |
| Saved result status, date and record link | [Results](2026-09-24-monitoring-clarity/results.png) |
| Finding action and plain audit history | [Finding](2026-09-24-monitoring-clarity/finding.png) |

### Authenticated local walkthrough

An existing fictional Owner account in the isolated, up-to-date local Supabase stack signed in to the production-mode preview at `http://127.0.0.1:3700/app/monitoring`. This was not the older port-3600 database and did not touch AWS or a real GitHub installation.

1. Monitoring loaded under **Milestone 2 Preview (fictional)** with the Owner role. It showed no recorded active findings without claiming monitoring was confirmed.
2. The one fictional repository showed its last collection as **Last check completed**. Its separate saved-result summary said **needs a new check**, counted one out-of-date result and labelled its earlier pass as previously passed. Fresh GitHub verification was visibly unavailable in this local runtime; the **Check GitHub now** button stayed disabled.
3. **Technical review and recovery** was collapsed by default and opened on click for the Owner. The desktop and 390-pixel mobile layouts retained the same status meaning without horizontal overflow.

| Authenticated view | Screenshot |
| --- | --- |
| Desktop, default reading path | [Authenticated desktop](2026-09-24-monitoring-clarity/authenticated-desktop.png) |
| Mobile, default reading path | [Authenticated mobile](2026-09-24-monitoring-clarity/authenticated-mobile.png) |

## Verification and limits

Fresh local focused component/page/domain tests (46 assertions after the final layout change), TypeScript, lint and the production build passed. An earlier full unit run, before the final presentational layout change, passed 3,436 assertions with three skipped. Independent Sol review identified three misleading or inaccessible labels; each was corrected and re-reviewed with no material remaining finding in those paths.

Two subsequent full-suite attempts were **not completed**: one parallel run saw a timing-sensitive, unrelated GitHub reconcile test fail before the resource guard stopped; that focused test then passed twice alone (22/22 each time). A single-worker full run was also stopped when the local resource monitor failed under Mac load. Neither stopped run is a green full-suite result for the final layout. No unrelated GitHub code was changed to mask it.

The earlier production build on `http://127.0.0.1:3600` reported `status: ok`, `db: ok` and the feature-branch source identity, but its local database has 45 unapplied migrations, including the GitHub results tables. That preview could not demonstrate the authenticated Monitoring route. It remains unchanged. A separate local stack at port 56431 had current migrations and an existing fictional Owner account, so it was used for the authenticated port-3700 walkthrough above. The first attempt on that stack exposed an exact parser mismatch: its control-room results included `freshness` and `mappingStatus`, which the strict application parser did not yet recognise. A read-only diagnostic showed that removing only those two fields made the same response parse. Muse implemented a bounded compatibility fix and tests, then the coordinator independently checked the diff, the authenticated page and the screenshots. The misleading collection badge was also corrected after the walkthrough exposed it.

Fresh targeted tests passed 91 of 91 across the parser and collection-status components; the production build, including TypeScript, passed after those changes. A fresh independent Sol review found no blocker in the four-file diff. The browser verified the fictional Owner's real local session, rendered data, disabled check action, collapsed technical area and mobile layout. No fresh live GitHub collection, Slack notification, AWS deployment, production release or human acceptance is claimed. No local database was reset or migrated for this walkthrough.

## AWS dev release

After the owner accepted the local design and authorised AWS dev deployment, the exact application source `5964627ccdab0cf6e01c84de4e29ce976383b9d0` was deployed through [run 36065161534](https://github.com/mukta2701/ComplianceHub/actions/runs/36065161534). Its deployment job succeeded; the optional GitHub reconciliation acceptance jobs were deliberately skipped. The preceding [branch CI run 36063832268](https://github.com/mukta2701/ComplianceHub/actions/runs/36063832268) passed secrets, changes, container, application and database jobs, including the browser tests updated for the new UI wording. Those tests kept exact assertions; no check was skipped or loosened.

A fresh hosted `GET /api/health` reported `status: ok`, `db: ok`, and the exact release SHA above. An unauthenticated request to `/app/monitoring` returned a 307 redirect to `/sign-in`, as expected for a protected page. This establishes the released source, database health and sign-in boundary; it does **not** demonstrate the signed-in AWS Monitoring UI or a new provider result. The screenshots above remain local fictional evidence. No GitHub App access, live repository, Slack destination or database data was changed for this deployment.

The next step is a signed-in AWS dev Monitoring walkthrough with the owner, followed separately by a fresh live GitHub/provider check and human acceptance.
