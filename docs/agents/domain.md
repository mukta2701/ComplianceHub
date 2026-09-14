# Domain documentation conventions

Read `CONTEXT.md` for domain vocabulary. This is a single-application repository, not a multi-context monorepo.

Read `docs/architecture.md`, relevant existing design/specification documents, and the release checklist before changing behavior. Existing decisions remain in those documents; do not duplicate them in a new ADR collection. Create an ADR only for a consequential, hard-to-reverse new trade-off that is not already documented.

The glossary contains domain meanings only. Implementation contracts belong in specifications and architecture documentation. Capability descriptions must distinguish source implementation, tested local behavior, live-provider proof and hosted/human acceptance.

The owner's current product direction is a growing company's ongoing security and compliance lifecycle. Onboarding, the saved baseline and the Mukta/Charlie scenario are parts of that direction, not product boundaries. Preserve historical narrower milestones but do not treat them as current scope limits.
