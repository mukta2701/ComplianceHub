import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { acquireLock, assertLocalTargets } from "./showcase-setup";

const memberEmail = "showcase-member@example.test";
const memberRole = "member";
const memberJobTitle = "Read-only Showcase Member";
const dir = path.resolve("artifacts/showcase-v1");
const manifestPath = path.join(dir, "member-manifest.json");
const credentialsPath = path.join(dir, "member-credentials.json");
const sessionPath = path.join(dir, "member-session.json");

type MainManifest = { version: string; ownerEmail: string; ids: { organisation?: string; user?: string } };
type Manifest = { version: "showcase-member-v1"; organisationId: string; ownerId: string; memberId?: string; invitationId?: string; invitationToken?: string };
type Credentials = { email: typeof memberEmail; password: string };

export function assertMemberEnvironment(env: Record<string, string | undefined>): void {
  assertLocalTargets(env.NEXT_PUBLIC_SUPABASE_URL ?? "", env.NEXT_PUBLIC_SITE_URL ?? "");
  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Member rehearsal requires explicit local Supabase keys");
}

async function json<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, "utf8")) as T; }
async function save(file: string, value: unknown): Promise<void> { await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); await chmod(file, 0o600); }

export async function main(): Promise<void> {
  assertMemberEnvironment(process.env);
  if (process.argv.slice(2).some((arg) => arg !== "--verify-only")) throw new Error("Only --verify-only is supported");
  const verifyOnly = process.argv.includes("--verify-only");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const lockDir = path.join(dir, "member-rehearsal");
  await mkdir(lockDir, { recursive: true, mode: 0o700 });
  const release = await acquireLock(lockDir);
  try {
  const api = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = createClient(api, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const admin = createClient(api, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const mainManifest = await json<MainManifest>(path.join(dir, "manifest.json"));
  if (mainManifest.version !== "showcase-v1" || mainManifest.ownerEmail !== "showcase-owner@example.test" || !mainManifest.ids.organisation || !mainManifest.ids.user) throw new Error("Showcase manifest identity is invalid");
  let manifest: Manifest;
  try { manifest = await json<Manifest>(manifestPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; manifest = { version: "showcase-member-v1", organisationId: mainManifest.ids.organisation, ownerId: mainManifest.ids.user }; await save(manifestPath, manifest); }
  if (manifest.version !== "showcase-member-v1" || manifest.organisationId !== mainManifest.ids.organisation || manifest.ownerId !== mainManifest.ids.user) throw new Error("Showcase member manifest identity collision");
  let credentials: Credentials;
  try { credentials = await json<Credentials>(credentialsPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; if (verifyOnly) throw new Error("Showcase member credentials are missing"); credentials = { email: memberEmail, password: `Ns-member-${randomBytes(24).toString("base64url")}-Aa1!` }; await writeFile(credentialsPath, JSON.stringify(credentials), { mode: 0o600, flag: "wx" }); }
  if (credentials.email !== memberEmail) throw new Error("Showcase member credential collision");
  const users: Array<{ id: string; email?: string; email_confirmed_at?: string | null }> = [];
  for (let page = 1; ; page++) { const result = await admin.auth.admin.listUsers({ page, perPage: 1000 }); if (result.error) throw result.error; users.push(...result.data.users.filter((user) => user.email === memberEmail)); if (result.data.users.length < 1000) break; }
  if (users.length > 1) throw new Error("Duplicate showcase member user; refusing mutation");
  let member = users[0];
  if (!member) {
    if (verifyOnly || manifest.memberId) throw new Error("Showcase member user is missing");
    const signup = await anon.auth.signUp({ email: credentials.email, password: credentials.password, options: { data: { name: "Northstar Showcase Member" } } });
    if (signup.error || !signup.data.user) throw new Error("Showcase member signup failed");
    member = signup.data.user;
    manifest.memberId = member.id;
    await save(manifestPath, manifest);
    const confirmed = await admin.auth.admin.updateUserById(member.id, { email_confirm: true });
    if (confirmed.error) throw confirmed.error;
  }
  if (manifest.memberId && manifest.memberId !== member.id) throw new Error("Showcase member ID collision");
  if (!manifest.memberId && users.length > 0) throw new Error("Unclaimed showcase member email collision");
  if (!member.email_confirmed_at) {
    if (verifyOnly) throw new Error("Showcase member is unconfirmed");
    const confirmed = await admin.auth.admin.updateUserById(member.id, { email_confirm: true });
    if (confirmed.error) throw confirmed.error;
  }
  manifest.memberId = member.id;
  await save(manifestPath, manifest);
  const organisations = await admin.from("organisations").select("id").eq("id", manifest.organisationId);
  if (organisations.error || organisations.data.length !== 1) throw new Error("Showcase organisation collision");
  const ownerMembership = await admin.from("memberships").select("user_id,role").eq("organisation_id", manifest.organisationId).eq("user_id", manifest.ownerId);
  if (ownerMembership.error || ownerMembership.data.length !== 1 || ownerMembership.data[0].role !== "owner") throw new Error("Showcase owner membership drift");
  const ownerLogin = await anon.auth.signInWithPassword({ email: "showcase-owner@example.test", password: (await json<{ password: string }>(path.join(dir, "credentials.json"))).password });
  if (ownerLogin.error || ownerLogin.data.user.id !== manifest.ownerId) throw new Error("Showcase owner credentials no longer match");
  const owner = createClient(api, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  await owner.auth.setSession({ access_token: ownerLogin.data.session!.access_token, refresh_token: ownerLogin.data.session!.refresh_token });
  const allMemberships = await admin.from("memberships").select("user_id,role,organisation_id").eq("user_id", member.id);
  if (allMemberships.error) throw allMemberships.error;
  if (allMemberships.data.some((row) => row.organisation_id !== manifest.organisationId)) throw new Error("Showcase member belongs to another organisation");
  const existing = { data: allMemberships.data.filter((row) => row.organisation_id === manifest.organisationId), error: null };
  if (existing.error) throw existing.error;
  if (existing.data.length > 1 || (existing.data[0] && existing.data[0].role !== memberRole)) throw new Error("Showcase member membership collision");
  if (!existing.data[0]) {
    if (verifyOnly) throw new Error("Showcase member membership is missing");
    const token = manifest.invitationToken ?? randomBytes(32).toString("base64url");
    if (manifest.invitationId && !manifest.invitationToken) throw new Error("Invitation token is missing; refusing to issue another invitation");
    if (!manifest.invitationId) {
    manifest.invitationToken = token;
    await save(manifestPath, manifest);
    const invitation = await owner.rpc("issue_invitation", { target_organisation_id: manifest.organisationId, target_email: memberEmail, target_role: memberRole, target_job_title: memberJobTitle, new_token_hash: createHash("sha256").update(token).digest("hex"), new_expires_at: new Date(Date.now() + 7 * 86400000).toISOString() });
    if (invitation.error || !invitation.data?.id) throw new Error("Showcase member invitation failed");
    manifest.invitationId = invitation.data.id;
    manifest.invitationToken = token;
    await save(manifestPath, manifest);
    }
    const accepted = await anon.auth.signInWithPassword(credentials);
    if (accepted.error) throw new Error("Showcase member credentials no longer match");
    const acceptance = await anon.rpc("accept_invitation", { raw_token: token });
    if (acceptance.error || acceptance.data !== manifest.organisationId) throw new Error("Showcase member invitation acceptance failed");
  }
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
  const context = await browser.newContext({ baseURL: process.env.NEXT_PUBLIC_SITE_URL });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/app"));
  await save(sessionPath, await context.storageState());
  } finally { await browser.close(); }
  process.stdout.write(`Showcase member rehearsal ready: ${memberEmail}\n`);
  } finally { await release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : "showcase-member failed"}\n`); process.exitCode = 1; });
