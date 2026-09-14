import { fetchAllPages } from "@/features/mcp/application/read-services";

/** Keep partial results out of totals when a page fails or the safety ceiling is reached. */
export async function loadPolicyRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  try { return { data: await fetchAllPages(page), error: null }; }
  catch { return { data: null, error: "Policy workspace records could not be fully loaded." }; }
}
