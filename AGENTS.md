<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project mentoring and completion reports

The owner is capable but learning and finds technical completion reports confusing. Use plain language and explain concepts only when they help with the current work.

- Read the plain-language status at the top of `docs/release-checklist.md` before reporting project completion. Keep that summary current when work changes its facts; preserve historical evidence below it. Do not create competing status trackers.
- Before implementation, state the bounded user-visible outcome and what will demonstrate it. Do not silently expand the task into redesign or additional features.
- End work with four short items: **Changed this session**, **Verified**, **Still unfinished**, and **Next step**. Include **Your input** only when an actual decision is needed, and explain why. For analysis-only work, explicitly say no application changes were made.
- Distinguish code implemented, automated checks passed, behavior demonstrated locally with fictional data, live-provider behavior demonstrated, and hosted release accepted. Never use one as proof of another or say the whole project is done because a smaller milestone passed.
- Identify whether verification is fresh or historical and which environment it covers. Keep commit IDs and test inventories in linked evidence unless needed for a technical decision. Do not invent completion percentages.
- Separate confirmed facts, reasonable assumptions and open questions. State an unresolved dependency and the responsible party without implying it was fixed.
- Keep task completion, human review, evidence freshness and provider-verified resolution distinct. Proposals and AI recommendations are not completed actions.
- Recommend one next step. Ask only questions necessary for the current decision; do not repeatedly ask questions already answered in the task history.

## GitHub synchronisation

Owner instruction confirmed 9 September 2026: after each coherent source or documentation change, run the relevant checks, commit the intended changes and push the active feature branch to the existing GitHub origin. Do not leave completed work only on this Mac. This is standing authorisation to commit and push project work; it does not authorise force-pushes, merging to the default branch, deployment, or publishing secrets, private evidence, credentials, runtime logs or generated local artifacts. If a push fails, retain the local commit and report the unsynchronised state clearly.
