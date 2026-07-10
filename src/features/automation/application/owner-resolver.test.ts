import { describe, expect, it, vi } from "vitest";
import { memoizeOwners } from "./owner-resolver";

describe("memoizeOwners", () => {
  it("fetches each org's owners only once", async () => {
    const fetchOwners = vi.fn(async (orgId: string) => [`${orgId}-owner`]);
    const resolve = memoizeOwners(fetchOwners);
    expect(await resolve("org1")).toEqual(["org1-owner"]);
    expect(await resolve("org1")).toEqual(["org1-owner"]);
    expect(await resolve("org2")).toEqual(["org2-owner"]);
    expect(fetchOwners).toHaveBeenCalledTimes(2); // org1 once, org2 once
  });
});
