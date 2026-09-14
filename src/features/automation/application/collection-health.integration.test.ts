// @vitest-environment node
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { recordCollectionHealth } from "./collector-persistence";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if ((!url || !["http://127.0.0.1:54321", "http://127.0.0.1:55321"].includes(url)) || !publicKey || !serviceKey) {
  throw new Error("Collection health integration requires a supported local Supabase stack on port 54321 or 55321.");
}

it("persists safe health for the matching connection and preserves tenant, provider, pause and revocation boundaries", async () => {
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const owner = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = randomUUID();
  const email = `collection-health-${suffix}@example.test`;
  const password = `Fictional-${randomUUID()}-9a!`;
  const connectionId = randomUUID();
  const previousSuccess = "2026-07-01T00:00:00+00:00";
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  expect(created.error).toBeNull(); const userId = created.data.user?.id; expect(userId).toBeTruthy();
  expect((await owner.auth.signInWithPassword({ email, password })).error).toBeNull();
  const org = await owner.rpc("create_organisation_with_owner", { organisation_name: "Collection health fictional test", organisation_slug: `health-${suffix}` });
  expect(org.error).toBeNull(); const organisationId = org.data; expect(organisationId).toBeTruthy();
  expect((await service.from("connector_connections").insert({ id: connectionId, organisation_id: organisationId, provider: "github", label: "Fictional collection health", owner_id: userId, connected_by: userId, consent: {}, status: "connected", last_collected_at: previousSuccess })).error).toBeNull();
  const readHealth = async () => {
    const result = await owner.from("connector_connections").select("status,last_collected_at,last_error_at,revoked_at").eq("id", connectionId).single();
    expect(result.error).toBeNull(); return result.data!;
  };
  const input = { supabase: service, organisationId: organisationId!, provider: "github" as const, config: { automationConnectionId: connectionId } };
  await recordCollectionHealth({ ...input, succeeded: false });
  expect(await readHealth()).toMatchObject({ status: "error", last_collected_at: previousSuccess, last_error_at: expect.any(String) });
  await recordCollectionHealth({ ...input, succeeded: true });
  const recovered = await readHealth();
  expect(recovered).toMatchObject({ status: "connected", last_error_at: null });
  expect(recovered.last_collected_at).not.toBe(previousSuccess);
  for (const patch of [{ organisationId: randomUUID() }, { provider: "aws" as const }]) {
    await recordCollectionHealth({ ...input, ...patch, succeeded: false });
    expect(await readHealth()).toEqual(recovered);
  }
  for (const patch of [{ status: "paused" }, { status: "setup" }, { status: "revoked" }, { status: "connected", revoked_at: "2026-08-01T00:00:00Z" }]) {
    expect((await service.from("connector_connections").update(patch).eq("id", connectionId)).error).toBeNull();
    const unavailable = await readHealth();
    await recordCollectionHealth({ ...input, succeeded: false });
    await recordCollectionHealth({ ...input, succeeded: true });
    expect(await readHealth()).toEqual(unavailable);
  }
  // Keep this uniquely named fictional workspace like the browser fixtures.
  // Existing immutable audit records and demonstration data are never removed.
});
