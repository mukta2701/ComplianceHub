// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import { collectEvidence } from "./collect-run";

const api = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!api || !["http://127.0.0.1:54321", "http://127.0.0.1:55321"].includes(api) || !publicKey || !serviceKey) throw new Error("Dated observations require a supported local Supabase stack on54321 or55321.");
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("preserves dated history and reviewed links while concurrent and interrupted collections converge", async () => {
  const nativeFetch = globalThis.fetch;
  const suffix = randomUUID();
  const sourceId = randomUUID();
  const connectionId = randomUUID();
  const email = `dated-observation-${suffix}@example.test`;
  const password = `Fictional-${randomUUID()}-A9!`;
  const auth = { persistSession: false, autoRefreshToken: false };
  const admin = createClient(api, serviceKey, { auth, global: { fetch: nativeFetch } });
  const owner = createClient(api, publicKey, { auth, global: { fetch: nativeFetch } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(created.error).toBeNull();
  const ownerId = created.data.user!.id;
  expect((await owner.auth.signInWithPassword({ email, password })).error).toBeNull();
  const workspace = await owner.rpc("create_organisation_with_owner", { organisation_name: "Dated observations — fictional", organisation_slug: `observations-${suffix}` });
  expect(workspace.error).toBeNull();
  const organisationId = String(workspace.data);
  expect((await admin.from("connector_connections").insert({ id: connectionId, organisation_id: organisationId, provider: "github", label: "Fictional dated collection", owner_id: ownerId, connected_by: ownerId, consent: {}, status: "connected" })).error).toBeNull();
  const config = { owner: "fictional", repo: "dated-observations", asOf: "2026-08-01", automationConnectionId: connectionId };
  expect((await owner.from("evidence_sources").insert({ id: sourceId, organisation_id: organisationId, provider: "github", label: "Fictional dated source", config, access_token: randomUUID(), connected_by: ownerId })).error).toBeNull();

  // The real collector uses the real database. Restrict its global source sweep
  // to this new fixture and inject failures only at a local HTTP write boundary.
  let failingTable: string | null = null;
  const service = createClient(api, serviceKey, { auth, global: { fetch: async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== api) throw new Error("Integration database request escaped the isolated stack");
    if (url.pathname === "/rest/v1/evidence_sources" && (!init?.method || init.method === "GET")) url.searchParams.set("id", `eq.${sourceId}`);
    if (init?.method === "POST" && url.pathname === `/rest/v1/${failingTable}`) return new Response(JSON.stringify({ message: "Fictional interrupted write", code: "XX000" }), { status: 503, headers: { "content-type": "application/json" } });
    return nativeFetch(url, init);
  } } });
  let protectedBranches = 1;
  vi.stubEnv("EVIDENCE_LIVE", "1");
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === "api.github.com" && url.pathname === "/repos/fictional/dated-observations/branches") return new Response(JSON.stringify(Array.from({ length: protectedBranches }, () => ({ protected: true }))), { headers: { "content-type": "application/json" } });
    if (url.origin === api) return nativeFetch(input, init);
    throw new Error("No live provider requests are allowed in this fictional test");
  });
  const readRows = async (table: string) => {
    let query = owner.from(table).select("*").eq("organisation_id", organisationId).order(table === "automation_proposal_sources" ? "proposal_id" : "id");
    if (table === "evidence") query = query.eq("source_id", sourceId);
    const response = await query;
    expect(response.error).toBeNull();
    return response.data!;
  };
  const readHealth = async () => {
    const response = await owner.from("connector_connections").select("status,last_collected_at,last_error_at").eq("id", connectionId).single();
    expect(response.error).toBeNull(); return response.data!;
  };
  const assertChainCount = async (count: number) => {
    for (const table of ["evidence", "source_objects", "automation_signals", "automation_proposals", "automation_proposal_sources"]) expect(await readRows(table), table).toHaveLength(count);
  };
  const setDay = async (asOf: string) => {
    config.asOf = asOf;
    expect((await owner.from("evidence_sources").update({ config }).eq("id", sourceId)).error).toBeNull();
  };

  await expect(collectEvidence(service)).resolves.toEqual({ collected: 1, refreshed: 0, failed: 0 });
  await assertChainCount(1);
  const firstEvidence = (await readRows("evidence"))[0];
  const firstProposal = (await readRows("automation_proposals"))[0];
  expect((await owner.rpc("review_automation_proposal", { target_proposal_id: firstProposal.id, target_decision: "accepted", target_dismissal_reason: null })).error).toBeNull();
  const reviewed = (await readRows("automation_proposals"))[0];
  expect(reviewed.status).toBe("accepted");
  const task = await owner.from("tasks").insert({ organisation_id: organisationId, title: "Earlier observation review — fictional", owner_id: ownerId, created_by: ownerId }).select("id").single();
  expect(task.error).toBeNull();
  expect((await owner.from("evidence_links").insert({ organisation_id: organisationId, evidence_id: firstEvidence.id, task_id: task.data!.id, created_by: ownerId })).error).toBeNull();
  const oldLinks = await readRows("evidence_links");

  await setDay("2026-09-01");
  await expect(collectEvidence(service)).resolves.toEqual({ collected: 1, refreshed: 0, failed: 0 });
  await assertChainCount(2);
  protectedBranches = 2;
  await expect(collectEvidence(service)).resolves.toEqual({ collected: 1, refreshed: 0, failed: 0 });
  await assertChainCount(3);
  await expect(collectEvidence(service)).resolves.toEqual({ collected: 0, refreshed: 1, failed: 0 });
  await assertChainCount(3);

  await setDay("2026-09-02");
  const concurrent = await Promise.all([collectEvidence(service), collectEvidence(service)]);
  expect(concurrent.map((result) => result.failed)).toEqual([0, 0]);
  expect(concurrent.reduce((total, result) => total + result.collected, 0)).toBe(1);
  await assertChainCount(4);

  const stages = ["evidence", "source_objects", "automation_signals", "automation_proposals", "automation_proposal_sources"];
  for (const [index, stage] of stages.entries()) {
    await setDay(`2026-09-${String(index + 3).padStart(2, "0")}`);
    const previousHealth = await readHealth();
    failingTable = stage;
    expect((await collectEvidence(service)).failed, stage).toBe(1);
    expect(await readHealth()).toMatchObject({ status: "error", last_collected_at: previousHealth.last_collected_at });
    failingTable = null;
    expect((await collectEvidence(service)).failed, stage).toBe(0);
    await assertChainCount(index + 5);
    expect(await readHealth()).toMatchObject({ status: "connected", last_error_at: null });
  }
  expect((await readRows("evidence")).find((row) => row.id === firstEvidence.id)).toEqual(firstEvidence);
  expect((await readRows("automation_proposals")).find((row) => row.id === reviewed.id)).toEqual(reviewed);
  expect(await readRows("evidence_links")).toEqual(oldLinks);
  const snapshots = await readRows("evidence");
  expect(snapshots.some((row) => row.collected_on === "2026-08-01" && row.description.startsWith("1 protected"))).toBe(true);
  expect(snapshots.some((row) => row.collected_on === "2026-09-01" && row.description.startsWith("2 protected"))).toBe(true);

  const legacy = await admin.from("evidence").insert({ organisation_id: organisationId, title: "Legacy collector example — fictional", kind: "note", description: "Fictional example of an older record with incomplete observation identity.", collected_on: "2026-07-01", source_id: sourceId, external_ref: "fictional-legacy-example", created_by: ownerId }).select("id").single();
  expect(legacy.error).toBeNull();

  if (api === "http://127.0.0.1:55321" && process.env.COMPLIANCEHUB_WRITE_OBSERVATION_DEMO === "1") {
    mkdirSync("artifacts/dated-observations", { recursive: true });
    writeFileSync("artifacts/dated-observations/demo.json", JSON.stringify({ email, password, organisationId, connectionId, sourceId, firstEvidenceId: firstEvidence.id, legacyEvidenceId: legacy.data!.id, reviewedProposalId: reviewed.id, taskId: task.data!.id, evidence: snapshots.map(({ id, collected_on, description }) => ({ id, collected_on, description })) }), { mode: 0o600 });
  }
  await owner.auth.signOut();
}, 90_000);
