import type { SupabaseClient } from "@supabase/supabase-js";

const DATABASE_BATCH_SIZE = 100;
const MAX_BATCHES_PER_RUN = 10;

export type AbandonedDigestRecoveryResult = {
  recovered: number;
  limitReached: boolean;
};

export async function recoverAbandonedDailyDigests(
  supabase: SupabaseClient,
): Promise<AbandonedDigestRecoveryResult> {
  let recovered = 0;
  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
    const { data, error } = await supabase.rpc("expire_abandoned_daily_digest_deliveries_server", {
      target_organisation_id: null,
      target_digest_on: null,
    });
    if (error) throw error;
    const count = Number(data);
    if (!Number.isInteger(count) || count < 0 || count > DATABASE_BATCH_SIZE) {
      throw new Error("Invalid abandoned digest recovery count");
    }
    recovered += count;
    if (count < DATABASE_BATCH_SIZE) return { recovered, limitReached: false };
  }
  return { recovered, limitReached: true };
}
