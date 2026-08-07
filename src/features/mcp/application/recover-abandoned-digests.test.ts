import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recoverAbandonedDailyDigests } from "./recover-abandoned-digests";

function clientWithBatches(batches: Array<number | { error: unknown }>) {
  const rpc = vi.fn(async () => {
    const next = batches.shift() ?? 0;
    return typeof next === "number" ? { data: next, error: null } : { data: null, error: next.error };
  });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("recoverAbandonedDailyDigests", () => {
  it("drains every full database batch until the final partial batch", async () => {
    const { client, rpc } = clientWithBatches([100, 100, 3]);
    await expect(recoverAbandonedDailyDigests(client)).resolves.toEqual({
      recovered: 203,
      limitReached: false,
    });
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("stops at the bounded ten-batch safety limit", async () => {
    const { client, rpc } = clientWithBatches(Array(12).fill(100));
    await expect(recoverAbandonedDailyDigests(client)).resolves.toEqual({
      recovered: 1_000,
      limitReached: true,
    });
    expect(rpc).toHaveBeenCalledTimes(10);
  });

  it("fails the stage when the server recovery boundary fails", async () => {
    const { client } = clientWithBatches([{ error: { code: "42501" } }]);
    await expect(recoverAbandonedDailyDigests(client)).rejects.toBeTruthy();
  });
});
