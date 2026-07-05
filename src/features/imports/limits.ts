// Shared ceiling between the analyse preview and the write path — keeps dry-run/commit CPU and insert-loop cost bounded.
// Lives outside actions.ts (a "use server" file) because Next.js only allows async function exports from
// "use server" modules — a plain exported constant there fails the production/client build.
export const MAX_IMPORT_ROWS = 500;
