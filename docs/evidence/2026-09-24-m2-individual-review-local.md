# Milestone 2 individual GitHub review — local evidence

This is a local feature-branch check using the fictional **Milestone 2 Preview** workspace. It is not a live GitHub App check or an AWS release.

## What changed

- An Owner reviews the 15 GitHub check-to-ISO mappings individually. Each decision uses the currently selected entry, its digest and expected revision; processing needs a current approved check actually present in the collection run. Earlier pack-wide approvals remain visible as history rather than the main decision path.
- An Admin may request a manual GitHub check. Repository selection, mapping decisions and recovery remain Owner-only. A Member cannot run or decide checks.
- Monitoring shows the number of pending Owner reviews and links directly to the open review section. Zero recorded findings is not presented as proof of coverage. A recent collection is labelled **Checked recently**, not **Up to date**.
- The 15-card desktop and phone layouts show each check's status, ISO references, result treatments and remediation without losing the existing ComplianceHub visual language.

## Fresh verification and limits

- Full application suite after the integrated action, role and review changes: **354 files passed, 3,211 tests passed, 3 intentionally skipped**. Later banner, copy and responsive refinements passed their focused tests; TypeScript and scoped lint passed. The final production build passed at source `5f58f39`.
- Earlier clean-install and upgrade database runs passed **110 files and 2,515 assertions each** after the job-finalisation fix. This review batch added no migration; those are not fresh reruns for the final visual commit.
- The independent production-mode preview at `http://127.0.0.1:3500/app/monitoring` reports both application and database healthy and release `5f58f39`. It uses the disposable local Supabase API on port 56431 and database on port 56432. The older 3400 preview and AWS were not rebuilt.
- In a real browser against this fictional database, an Owner approved one pending check, rejected it, and approved it again. The review counts changed from 14 pending / 1 approved to 13 / 2, then 13 / 1 / 1 rejected, then back to 13 / 2. An Admin view showed the manual-check control and no mapping-decision controls; a Member view showed neither. The manual check was disabled because live GitHub credentials are intentionally absent in this local preview. This does **not** verify a live provider collection.
- Desktop and phone screenshots were saved locally in `/tmp/compliancehub-m2-monitoring-5f-owner-top.png`, `/tmp/compliancehub-m2-monitoring-5f-repository.png`, and `/tmp/compliancehub-m2-monitoring-final-mobile-review.png`. They are local fictional evidence, not source artifacts or proof of the AWS version.
- The temporary fictional QA membership was removed after role testing. Its audit identity remains in the disposable database because decision history refers to it. The original fictional Owner membership remains.

## CISO reading and release gate

The page now separates **no recorded findings**, **one currently approved result**, **13 mappings still awaiting review**, and **collection recency**. That is more useful than a single green status: the Owner can see what still needs a decision and the reader cannot mistake a recent collection for ISO compliance.

Do not deploy this partial Milestone 2 branch yet. The daily schedule, private-channel alerts for changed compliance results, built-in AI mapping suggestions with Owner acceptance, and a live selected-repository end-to-end test are still open. The next bounded implementation step is the daily collection trigger and its failure/duplicate safeguards, followed by a private-channel alert rehearsal. AI suggestions are planned after that deterministic foundation, not behind an “enable AI” toggle.
