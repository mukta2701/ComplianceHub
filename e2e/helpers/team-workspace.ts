import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";

const isolatedApi = "http://127.0.0.1:55321";
const configuredApi = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const teamTestEnabled = configuredApi === isolatedApi;

export type Actor = { id: string; email: string; password: string };
export async function signIn(page: Page, actor: Actor) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(actor.email);
  await page.getByLabel("Password", { exact: true }).fill(actor.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app(?:\/.*)?$/);
}
export async function clientFor(actor: Actor): Promise<SupabaseClient> {
  const client = createClient(isolatedApi, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: actor.email, password: actor.password });
  if (error) throw new Error("Fictional actor sign-in failed");
  return client;
}
export async function createTeamFixture() {
  if (configuredApi !== isolatedApi || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Isolated local fixture credentials required");
  const admin = createClient(isolatedApi, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = randomUUID().slice(0, 8);
  const actors: Actor[] = [];
  for (const label of ["coordinator", "first-owner", "second-owner", "leadership-reader"]) {
    const email = `contribution-${label}-${suffix}@example.test`;
    const password = `Fictional-${randomBytes(18).toString("base64url")}!A9`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: `Demo ${label}` } });
    if (error || !data.user) throw new Error(`Could not create fictional ${label}`);
    actors.push({ id: data.user.id, email, password });
  }
  const coordinator = await clientFor(actors[0]);
  const { data: organisationId, error: orgError } = await coordinator.rpc("create_organisation_with_owner", { organisation_name: `Contribution demonstration ${suffix}`, organisation_slug: `contribution-demo-${suffix}` });
  if (orgError) throw orgError;
  const { error: memberError } = await admin.from("memberships").insert(actors.slice(1).map((actor) => ({ organisation_id: organisationId, user_id: actor.id, role: "member" })));
  if (memberError) throw memberError;
  const { data: tasks, error: taskError } = await coordinator.from("tasks").insert(actors.slice(1, 3).map((actor, index) => ({ organisation_id: organisationId, owner_id: actor.id, created_by: actors[0].id, title: `${index === 0 ? "Access review" : "Backup restoration"} — fictional ${suffix}`, detail: "Fictional demonstration. Record the checks, outcome and limitations for review.", status: "in_progress", due_on: "2026-09-16" }))).select("id,owner_id,status,assignment_revision");
  if (taskError || tasks?.length !== 2) throw new Error("Could not create assigned fictional tasks");
  return { actors, organisationId: String(organisationId), coordinator, tasks: actors.slice(1, 3).map((actor) => tasks.find((task) => task.owner_id === actor.id)!) };
}

