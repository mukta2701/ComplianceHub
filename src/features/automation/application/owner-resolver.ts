// Memoizes owner lookups per organisation so the nightly sweep issues at most
// one owner query per org instead of one per row (avoiding an N+1 as tenant
// count grows). Callers are responsible for handling an empty owner list
// safely (e.g. skipping the row) rather than assuming an owner always exists.
export function memoizeOwners(
  fetchOwners: (orgId: string) => Promise<string[]>,
): (orgId: string) => Promise<string[]> {
  const cache = new Map<string, Promise<string[]>>();
  return (orgId: string) => {
    let pending = cache.get(orgId);
    if (!pending) {
      pending = fetchOwners(orgId);
      cache.set(orgId, pending);
    }
    return pending;
  };
}
