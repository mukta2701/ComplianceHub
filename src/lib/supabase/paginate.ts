export const SUPABASE_PAGE_SIZE = 500;

export async function collectStringCursorPages<T>(
  fetchPage: (afterId: string | null, limit: number) => Promise<T[]>,
  cursorFor: (row: T) => string,
  options: { pageSize?: number } = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? SUPABASE_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1_000) {
    throw new Error("Invalid Supabase page size");
  }

  const rows: T[] = [];
  let afterId: string | null = null;
  for (;;) {
    const page = await fetchPage(afterId, pageSize);
    if (page.length > pageSize) throw new Error("Supabase page exceeded its requested limit");
    let previousId = afterId;
    for (const row of page) {
      const cursor = cursorFor(row);
      if (typeof cursor !== "string" || !cursor || (previousId !== null && cursor <= previousId)) {
        throw new Error("Supabase page did not preserve stable ID order");
      }
      previousId = cursor;
    }
    rows.push(...page);
    if (page.length < pageSize) return rows;
    afterId = cursorFor(page[page.length - 1]!);
  }
}

export async function collectIdPages<T extends { id: string }>(
  fetchPage: (afterId: string | null, limit: number) => Promise<T[]>,
  options: { pageSize?: number } = {},
): Promise<T[]> {
  return collectStringCursorPages(fetchPage, (row) => row.id, options);
}
