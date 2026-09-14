// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildDailyDigestFacts, hashDailyDigestFacts } from "../domain/digest";
import { isDestructiveIntegrationTargetAllowed } from "@/test/destructive-integration-target";
import { prepareDailyDigest } from "./mcp-reads";
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
const targetAllowed = isDestructiveIntegrationTargetAllowed(url);
const live = Boolean(url && publicKey && serviceKey && targetAllowed);
if (!live) {
  throw new Error(
    "Daily-digest integration tests require NEXT_PUBLIC_SUPABASE_URL, "
    + "NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY for a disposable localhost Supabase stack.",
  );
}
const admin = createClient(url ?? "http://127.0.0.1:54321", serviceKey ?? "missing", {
  auth: { persistSession: false, autoRefreshToken: false },
});
const runId = randomUUID().slice(0, 8);
const password = `Digest-${randomUUID()}-9a!`;
let userId = "";
let workspaceId = "";
let channelId = "";
let ownerClient: SupabaseClient;
const APPROVED_SLACK_WEBHOOK = "https://hooks.slack.com/services/T_TEST/B_TEST/S_TEST";
const APPROVED_SLACK_WEBHOOK_SHA256 = "36b243d5b0e2304cbdf6f5bf362061b4f0e5cdc842c7f407af9253d0207cce52";
const previousSlackAllowedWebhookSha256 = process.env.SLACK_ALLOWED_WEBHOOK_SHA256;

beforeAll(async () => {
  process.env.SLACK_ALLOWED_WEBHOOK_SHA256 = APPROVED_SLACK_WEBHOOK_SHA256;
  const created = await admin.auth.admin.createUser({
    email: `digest-concurrency-${runId}@example.test`,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) throw created.error ?? new Error("User setup failed");
  userId = created.data.user.id;
  ownerClient = createClient(String(url), String(publicKey), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await ownerClient.auth.signInWithPassword({
    email: `digest-concurrency-${runId}@example.test`,
    password,
  });
  if (signedIn.error) throw signedIn.error;
  const organisation = await ownerClient.rpc("create_organisation_with_owner", {
    organisation_name: `Digest concurrency ${runId}`,
    organisation_slug: `digest-concurrency-${runId}`,
  });
  if (organisation.error || typeof organisation.data !== "string") {
    throw organisation.error ?? new Error("Organisation setup failed");
  }
  workspaceId = organisation.data;
  const channel = await ownerClient.from("alert_channels").insert({
    organisation_id: workspaceId,
    type: "slack",
    label: "Concurrency test",
    config: { webhookUrl: "v1:test-iv:test-tag:test-data", webhookSha256: APPROVED_SLACK_WEBHOOK_SHA256 },
    connected_by: userId,
    enabled: true,
    daily_digest_enabled: false,
  }).select("id").single();
  if (channel.error || !channel.data) throw channel.error ?? new Error("Digest channel setup failed");
  channelId = channel.data.id;
  const selected = await ownerClient.rpc("set_daily_digest_channel", {
    target_organisation_id: workspaceId,
    target_channel_id: channel.data.id,
  });
  if (selected.error || selected.data !== true) throw selected.error ?? new Error("Digest channel setup failed");
}, 30_000);

afterAll(() => {
  if (previousSlackAllowedWebhookSha256 === undefined) delete process.env.SLACK_ALLOWED_WEBHOOK_SHA256;
  else process.env.SLACK_ALLOWED_WEBHOOK_SHA256 = previousSlackAllowedWebhookSha256;
});

// Tenant teardown is intentionally unavailable: organisation deletion would
// cascade into immutable audit history, and deleting the sole Owner would
// violate the tenant ownership invariant. Each run therefore uses unique,
// inert fixture names. Safety comes from the localhost-only guard above and
// destroying the disposable Supabase stack after the integration run.

describe("concurrent daily digest delivery", () => {
  it("uses schema-v2 verified facts for the trusted scheduled prepare path without a send", async () => {
    const prepared = await prepareDailyDigest(ownerClient, userId, {
      workspaceId,
      localDate: "2026-08-08",
    });

    expect(prepared).toMatchObject({
      status: "ready",
      facts: {
        schemaVersion: 2,
        github: {
          partition: { total: 0 },
          baseline: null,
          changes: { counts: { total: 0 }, items: [], truncated: false },
        },
      },
      delivery: null,
    });
  }, 30_000);

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
      github: {
        partition: { activeCurrentPass: 0, activeCurrentFail: 0, activeCurrentUnknown: 0, activeCurrentNotApplicable: 0, activeStale: 0, historical: 0, total: 0 },
        baseline: null,
        changes: { counts: { newFailure: 0, reopen: 0, resolution: 0, supersedingPass: 0, total: 0 }, items: [], truncated: false },
        unknowns: { count: 0, items: [], truncated: false },
        staleResults: { count: 0, items: [], truncated: false },
        recommendedActions: { count: 0, items: [], truncated: false },
      },
    });
    expect(facts.schemaVersion).toBe(2);
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
          target_expected_channel_id: input.expectedChannelId,
          target_digest_on: input.localDate,
          target_fact_hash: input.factHash,
          target_message: input.message,
        });
        if (error) throw error;
        return data as Awaited<ReturnType<PostDailyDigestDependencies["reserve"]>>;
      },
      loadSelectedSlackDestination: async () => ({
        channelId,
        encryptedWebhook: "v1:test-iv:test-tag:test-data",
        webhookSha256: APPROVED_SLACK_WEBHOOK_SHA256,
      }),
      decryptWebhook: () => APPROVED_SLACK_WEBHOOK,
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
      headline: "75% readiness",
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
