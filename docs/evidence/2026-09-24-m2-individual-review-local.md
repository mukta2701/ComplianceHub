# Milestone 2 individual GitHub review

This is a local feature-branch check using the fictional **Milestone 2 Preview** workspace. It is not a live GitHub App check or an AWS release.

## What changed

- An Owner reviews the 15 GitHub check-to-ISO mappings individually. Each decision uses the currently selected entry, its digest and expected revision; processing needs a current approved check actually present in the collection run. Earlier pack-wide approvals remain visible as history rather than the main decision path.
- An Admin may request a manual GitHub check. Repository selection, mapping decisions and recovery remain Owner-only. A Member cannot run or decide checks.
- Monitoring shows the number of pending Owner reviews and links directly to the open review section. Zero recorded findings is not presented as proof of coverage. A recent collection is labelled **Checked recently**, not **Up to date**.
- The 15-card desktop and phone layouts show each check's status, ISO references, result treatments and remediation without losing the existing ComplianceHub visual language.
- An independent review caught two mismatches after the browser walkthrough. The Owner's processing control had still required the old whole-pack approval even when an individual check was approved; it now uses the effective per-check approvals. The history section now says it contains earlier pack-wide approvals, and a per-check decision shows its decision date. The server still checks that an approved exact check is present in the target collection run before writing official results.

## Fresh verification and limits

- Full application suite after the final control/history fix: **354 files passed, 3,212 tests passed, 3 intentionally skipped**. A new UI regression test first failed against the old screen and then passed after the fix, covering an Owner's processing action with an individual approval and no whole-pack approval. TypeScript, full lint and the final production build passed at source `1dd02f3`.
- Earlier clean-install and upgrade database runs passed **110 files and 2,515 assertions each** after the job-finalisation fix. This review batch added no migration; those are not fresh reruns for the final visual commit.
- The independent production-mode preview at `http://127.0.0.1:3500/app/monitoring` reports both application and database healthy and release `1dd02f3`. It uses the disposable local Supabase API on port 56431 and database on port 56432. An unauthenticated request to Monitoring redirects to sign-in as expected. The older 3400 preview and AWS were not rebuilt.
- In a browser against this fictional database, an Owner approved one pending check, rejected it, and approved it again. The review first showed 14 pending and 1 approved. It then showed 13 pending and 2 approved; 13 pending, 1 approved and 1 rejected; and finally 13 pending and 2 approved. An Admin view showed the manual-check control and no mapping-decision controls. A Member view showed neither. The manual check was disabled because live GitHub credentials are intentionally absent in this local preview. This does **not** verify a live provider collection.
- Desktop and phone screenshots were saved locally in `/tmp/compliancehub-m2-monitoring-5f-owner-top.png`, `/tmp/compliancehub-m2-monitoring-5f-repository.png`, and `/tmp/compliancehub-m2-monitoring-final-mobile-review.png`. They show the preceding source build's layout. The final processing-control and history-copy fix is covered by the fresh component test and production build, not by a new authenticated browser screenshot. These are local fictional evidence, not proof of the AWS version.
- The temporary fictional QA membership was removed after role testing. Its audit identity remains in the disposable database because decision history refers to it. The original fictional Owner membership remains.

## CISO reading and release gate

The page now separates **no recorded findings**, **one currently approved result**, **13 mappings still awaiting review**, and **collection recency**. That is more useful than a single green status: the Owner can see what still needs a decision and the reader cannot mistake a recent collection for ISO compliance.

Do not deploy this partial Milestone 2 branch yet. The daily schedule, private-channel alerts for changed compliance results, built-in AI mapping suggestions with Owner acceptance, and a live selected-repository end-to-end test are still open. The next bounded implementation step is the daily collection trigger and its failure/duplicate safeguards, followed by a private-channel alert rehearsal. AI suggestions are planned after that deterministic foundation, not behind an “enable AI” toggle.
