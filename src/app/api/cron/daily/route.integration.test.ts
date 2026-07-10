import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Live-DB integration test (plan Task 10, Step 6): proves against the real
// local Supabase stack that the sweep moves state and that the onConflict
// targets match actual database constraints, including under concurrent runs.
// (`server-only`, imported transitively via the service client, is stubbed by
// a vitest alias — it is a Next-only marker module, not an installed package.)

// vitest does not load .env.local; hydrate the Supabase env vars from it when it
// exists. On a fresh checkout / CI, the file is gitignored and absent — do not
// throw ENOENT at collection; the suite skips itself below when env is missing.
const envFile = path.join(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

import { GET } from "./route";

const CRON_SECRET = "integration-test-secret";
const TIMEOUT = 30_000;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const missingEnv = !url || !serviceKey;
if (missingEnv) {
  console.warn(
    "[route.integration] Skipping live-DB integration tests: NEXT_PUBLIC_SUPABASE_URL and " +
      "SUPABASE_SERVICE_ROLE_KEY are not set. Provide them via .env.local or `supabase status` " +
      "and run against a live stack with `npm run test:integration`.",
  );
}
// Dummy fallbacks keep createClient from throwing at import when env is absent;
// the describe below is skipped in that case, so these are never used.
const admin = createClient(url ?? "http://127.0.0.1:54321", serviceKey ?? "missing", {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = randomUUID().slice(0, 8);
const todayIso = new Date().toISOString().slice(0, 10);
const yesterdayIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

let userId: string;
let organisationId: string;
let evidenceId: string;
let seededTaskId: string;

function request(token: string): Request {
  return new Request("http://localhost/api/cron/daily", { headers: { authorization: `Bearer ${token}` } });
}

async function insertStaleEvidence(title: string): Promise<string> {
  const { data, error } = await admin.from("evidence").insert({
    organisation_id: organisationId, title, kind: "note", owner_id: userId,
    valid_until: yesterdayIso, created_by: userId,
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

const expiryTasksFor = async (forEvidenceId: string) => {
  const { data, error } = await admin.from("tasks").select("id")
    .eq("organisation_id", organisationId).eq("source", "evidence_expiry").eq("evidence_id", forEvidenceId);
  if (error) throw error;
  return data;
};

beforeAll(async () => {
  vi.stubEnv("CRON_SECRET", CRON_SECRET);

  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email: `sweep-it-${runId}@example.test`, email_confirm: true,
  });
  if (userError) throw userError;
  userId = created.user.id; // profiles row is created by the on_auth_user_created trigger

  const { data: org, error: orgError } = await admin.from("organisations")
    .insert({ name: `Sweep IT ${runId}`, slug: `sweep-it-${runId}`, created_by: userId }).select("id").single();
  if (orgError) throw orgError;
  organisationId = org.id;

  const { error: memberError } = await admin.from("memberships")
    .insert({ organisation_id: organisationId, user_id: userId, role: "owner" });
  if (memberError) throw memberError;

  evidenceId = await insertStaleEvidence("Stale backup report");

  const { data: task, error: taskError } = await admin.from("tasks").insert({
    organisation_id: organisationId, title: "Overdue firewall review", status: "open",
    owner_id: userId, due_on: yesterdayIso, source: "manual", created_by: userId,
  }).select("id").single();
  if (taskError) throw taskError;
  seededTaskId = task.id;
}, TIMEOUT);

afterAll(async () => {
  // Full tenant removal is impossible by schema design: evidence is never
  // deletable (evidence_no_delete) which blocks the organisation cascade, and
  // protect_last_owner blocks removing the sole owner membership. Remove the
  // rows that can go (notifications, tasks); the remaining throwaway rows are
  // uniquely named per run and inert for future sweeps (evidence stays
  // "expired", which the sweep never re-reads).
  await admin.from("notifications").delete().eq("organisation_id", organisationId);
  await admin.from("tasks").delete().eq("organisation_id", organisationId);
  vi.unstubAllEnvs();
}, TIMEOUT);

describe.skipIf(missingEnv)("GET /api/cron/daily against the live database", () => {
  it("rejects a wrong bearer token with 401 and does not sweep", { timeout: TIMEOUT }, async () => {
    const response = await GET(request("wrong-secret"));
    expect(response.status).toBe(401);
    expect(await expiryTasksFor(evidenceId)).toHaveLength(0);
  });

  it("expires stale evidence, raises exactly one expiry task, and notifies the owner", { timeout: TIMEOUT }, async () => {
    const response = await GET(request(CRON_SECRET));
    expect(response.status).toBe(200);
    const summary = await response.json();
    // Response shape changed under Task 10: the sweep summary now lives under
    // `.sweep`, alongside the new `.collect` and `.sync` pipeline stages.
    expect(summary.sweep.evidenceExpired).toBeGreaterThanOrEqual(1);
    expect(summary.sweep.tasksCreated).toBeGreaterThanOrEqual(1);

    const { data: evidence } = await admin.from("evidence").select("status").eq("id", evidenceId).single();
    expect(evidence?.status).toBe("expired");

    expect(await expiryTasksFor(evidenceId)).toHaveLength(1);

    const { data: notifications } = await admin.from("notifications")
      .select("kind,subject_id").eq("user_id", userId).eq("sweep_on", todayIso);
    expect(notifications).toEqual(expect.arrayContaining([
      { kind: "evidence_expired", subject_id: evidenceId },
      { kind: "task_overdue", subject_id: seededTaskId },
    ]));
  });

  it("stays idempotent when two sweeps hit the database concurrently", { timeout: TIMEOUT }, async () => {
    // Fresh stale evidence with no covering task: both concurrent sweeps race
    // to create its expiry task and notifications; the database constraints
    // must dedupe.
    const racedEvidenceId = await insertStaleEvidence("Raced stale cert");

    const [first, second] = await Promise.all([GET(request(CRON_SECRET)), GET(request(CRON_SECRET))]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const { data: raced } = await admin.from("evidence").select("status").eq("id", racedEvidenceId).single();
    expect(raced?.status).toBe("expired");

    expect(await expiryTasksFor(racedEvidenceId)).toHaveLength(1);
    expect(await expiryTasksFor(evidenceId)).toHaveLength(1); // still exactly one from the earlier run

    const { data: notifications } = await admin.from("notifications")
      .select("user_id,kind,subject_type,subject_id,sweep_on").eq("user_id", userId).eq("sweep_on", todayIso);
    const keys = (notifications ?? []).map((n) => [n.user_id, n.kind, n.subject_type, n.subject_id, n.sweep_on].join("|"));
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length); // same-day counts all remain one
  });
});
