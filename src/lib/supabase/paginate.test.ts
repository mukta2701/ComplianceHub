import { describe, expect, it, vi } from "vitest";

describe("collectIdPages", () => {
  it("collects every stable ID-ordered page without an offset ceiling", async () => {
    const pagination = await import("./paginate").catch(() => null);
    expect(pagination).not.toBeNull();
    if (!pagination) return;

    const rows = Array.from({ length: 1_205 }, (_, index) => ({
      id: String(index + 1).padStart(4, "0"),
      value: index + 1,
    }));
    const fetchPage = vi.fn(async (afterId: string | null, limit: number) => {
      const start = afterId ? rows.findIndex((row) => row.id === afterId) + 1 : 0;
      return rows.slice(start, start + limit);
    });

    await expect(pagination.collectIdPages(fetchPage, { pageSize: 500 })).resolves.toEqual(rows);
    expect(fetchPage).toHaveBeenNthCalledWith(1, null, 500);
    expect(fetchPage).toHaveBeenNthCalledWith(2, "0500", 500);
    expect(fetchPage).toHaveBeenNthCalledWith(3, "1000", 500);
  });

  it("fails closed when a page is not strictly ID ordered", async () => {
    const pagination = await import("./paginate").catch(() => null);
    expect(pagination).not.toBeNull();
    if (!pagination) return;

    await expect(pagination.collectIdPages(async () => [{ id: "b" }, { id: "a" }]))
      .rejects.toThrow("stable ID order");
  });
});
