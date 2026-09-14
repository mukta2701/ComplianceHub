// Shared ceiling between the analyse preview and the write path — keeps dry-run/commit CPU and insert-loop cost bounded.
// Lives outside actions.ts (a "use server" file) because Next.js only allows async function exports from
// "use server" modules — a plain exported constant there fails the production/client build.
export const MAX_IMPORT_ROWS = 500;

// XLSX is a spreadsheet container, but ComplianceHub imports are CSV-shaped
// tables. These ceilings keep sparse dimensions and dense cell collections
// bounded before converting the first worksheet to an in-memory string grid.
export const MAX_XLSX_ROW_INDEX = 10_000;
export const MAX_XLSX_COLUMNS = 100;
export const MAX_XLSX_POPULATED_CELLS = 25_000;
export const MAX_XLSX_WORKSHEETS = 5;
