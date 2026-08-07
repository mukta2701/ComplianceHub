// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildDailyDigestFacts, hashDailyDigestFacts } from "../domain/digest";
import { postDailyDigest, type PostDailyDigestDependencies } from "./post-daily-digest";

const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const live = Boolean(url && publicKey && serviceKey);
const admin = createClient(url ?? "http://127.0.0.1:54321", serviceKey ?? "missing", {
  auth: { persistSession: false, autoRefreshToken: false },
});
const runId = randomUUID().slice(0, 8);
const password = `Digest-${randomUUID()}-9a!`;
let userId = "";
let workspaceId = "";
let ownerClient: SupabaseClient;

beforeAll(async () => {
  if (!live) return;
  const created = await admin.auth.admin.createUser({
    email: `digest-concurrency-${runId}@example.test`,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) throw created.error ?? new Error("User setup failed");
  userId = created.data.user.id;
  const organisation = await admin.from("organisations").insert({
    name: `Digest concurrency ${runId}`,
    slug: `digest-concurrency-${runId}`,
    created_by: userId,
  }).select("id").single();
  if (organisation.error) throw organisation.error;
  workspaceId = organisation.data.id;
  const membership = await admin.from("memberships").insert({
    organisation_id: workspaceId,
    user_id: userId,
    role: "owner",
  });
  if (membership.error) throw membership.error;
  ownerClient = createClient(String(url), String(publicKey), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await ownerClient.auth.signInWithPassword({
    email: `digest-concurrency-${runId}@example.test`,
    password,
  });
  if (signedIn.error) throw signedIn.error;
  const channel = await ownerClient.from("alert_channels").insert({
    organisation_id: workspaceId,
    type: "slack",
    label: "Concurrency test",
    config: { webhookUrl: "test-encrypted" },
    connected_by: userId,
    enabled: true,
    daily_digest_enabled: true,
  });
  if (channel.error) throw channel.error;
}, 30_000);

afterAll(async () => {
  if (!live) return;
  if (workspaceId && ownerClient) await ownerClient.from("organisations").delete().eq("id", workspaceId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe.runIf(live)("concurrent daily digest delivery", () => {
  it("creates exactly one reservation and one network send path", async () => {
    const facts = buildDailyDigestFacts({
      workspace: { id: workspaceId, name: `Digest concurrency ${runId}` },
      localDate: "2026-08-07",
      overview: {
        soaPercent: 75,
        soaTotal: 4,
        riskBands: { low: 1, moderate: 1, high: 1, very_high: 0 },
        tasksOpen: 2,
        tasksOverdue: 1,
        evidence: { total: 3, expiring: 1, expired: 0 },
        openAudits: 1,
        openNonConformities: 0,
      },
      attentionItems: [],
      monitoringFindings: [],
      latestLeadershipReport: null,
    });
    const factHash = hashDailyDigestFacts(facts);
    const deliver = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { outcome: "delivered" as const };
    });
    const dependencies: PostDailyDigestDependencies = {
      resolveWorkspace: vi.fn(async () => ({ id: workspaceId, name: facts.workspace.name, role: "owner" as const })),
      prepare: vi.fn(async () => ({ status: "ready" as const, facts, factHash, delivery: null })),
      rateLimit: vi.fn(async () => undefined),
      createDeliveryClient: () => admin,
      reserve: async (client, input) => {
        const { data, error } = await client.rpc("reserve_daily_digest_delivery_server", {
          target_organisation_id: input.workspaceId,
          target_actor_id: input.actorUserId,
          target_digest_on: input.localDate,
          target_fact_hash: input.factHash,
          target_message: input.message,
        });
        if (error) throw error;
        return data as Awaited<ReturnType<PostDailyDigestDependencies["reserve"]>>;
      },
      loadEncryptedWebhook: async () => "test-encrypted",
      decryptWebhook: () => "https://hooks.slack.com/services/T/B/secret",
      isChannelActive: async (client, input) => {
        const { data, error } = await client.from("alert_channels").select("id")
          .eq("id", input.channelId)
          .eq("organisation_id", input.workspaceId)
          .eq("enabled", true)
          .eq("daily_digest_enabled", true)
          .is("revoked_at", null)
          .maybeSingle();
        if (error) throw error;
        return data !== null;
      },
      deliver,
      finalize: async (client, input) => {
        const { data, error } = await client.rpc("finalize_daily_digest_delivery_server", {
          target_delivery_id: input.deliveryId,
          target_actor_id: input.actorUserId,
          target_attempt_number: input.attemptNumber,
          target_outcome: input.outcome,
          target_error_code: input.errorCode ?? null,
        });
        if (error) throw error;
        return data === true;
      },
    };
    const input = {
      workspaceId,
      localDate: "2026-08-07",
      factHash,
      headline: "75% ready",
      priorities: ["1 overdue task"],
      actions: ["Review 1 high risk"],
    };

    const results = await Promise.allSettled([
      postDailyDigest({ supabase: {} as SupabaseClient, userId, clientId: "codex-a", input }, dependencies),
      postDailyDigest({ supabase: {} as SupabaseClient, userId, clientId: "codex-b", input }, dependencies),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: { code: "DELIVERY_UNKNOWN" } });
    expect(deliver).toHaveBeenCalledTimes(1);
    const deliveries = await ownerClient.from("daily_digest_deliveries")
      .select("id,status,daily_digest_delivery_attempts(id)")
      .eq("organisation_id", workspaceId)
      .eq("digest_on", "2026-08-07");
    expect(deliveries.error).toBeNull();
    expect(deliveries.data).toEqual([
      expect.objectContaining({ status: "delivered", daily_digest_delivery_attempts: [expect.any(Object)] }),
    ]);
  }, 30_000);
});
