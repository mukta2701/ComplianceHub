import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

function localEnvironment(name: string): string {
  if (process.env[name]) return process.env[name] as string;
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) throw new Error(`${name} is required for the digest administration end-to-end test`);
  const line = readFileSync(envPath, "utf8")
    .split("\n")
    .find((candidate) => candidate.startsWith(`${name}=`));
  if (!line) throw new Error(`${name} is required for the digest administration end-to-end test`);
  return line.slice(name.length + 1);
}

function testPassword(seed: string): string {
  return `E2e-${createHash("sha256").update(seed).digest("hex").slice(0, 24)}-Aa1!`;
}

function serviceClient() {
  return createClient(
    localEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    localEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function confirmLocalUser(email: string): Promise<string> {
  const service = serviceClient();
  let userId: string | null = null;
  for (let page = 1; page <= 10 && userId === null; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1_000 });
    if (error) throw error;
    userId = data.users.find((user) => user.email === email)?.id ?? null;
    if (data.users.length < 1_000) break;
  }
  if (!userId) throw new Error("Synthetic digest-administration user was not found");
  const { error } = await service.auth.admin.updateUserById(userId, { email_confirm: true });
  if (error) throw error;
  return userId;
}

async function completeLocalSignUp(page: Page, email: string, password: string): Promise<string> {
  await Promise.all([
    page.waitForURL((url) => ["/sign-in", "/app", "/app/onboarding"].includes(url.pathname)),
    page.getByRole("button", { name: "Create account" }).click(),
  ]);
  const userId = await confirmLocalUser(email);
  if (new URL(page.url()).pathname === "/sign-in") {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page.getByRole("heading", { name: "Create your organisation" })).toBeVisible();
  return userId;
}

async function submitServerAction(page: Page, button: Locator, pathname: string) {
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === pathname,
  );
  const [response] = await Promise.all([responsePromise, button.click()]);
  expect(response.status()).toBeLessThan(400);
}

async function createOwnerWorkspace(page: Page, testInfo: TestInfo) {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `digest-owner-${suffix}@example.test`;
  const password = testPassword(`owner:${suffix}`);
  const organisationName = `Digest Workspace ${suffix}`;

  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Digest Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  const userId = await completeLocalSignUp(page, email, password);
  await page.getByLabel("Organisation name").fill(organisationName);
  await submitServerAction(page, page.getByRole("button", { name: "Create workspace" }), "/app");
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();

  return { suffix, email, password, organisationName, userId };
}

async function createInvitedAdmin(input: {
  suffix: string;
  ownerEmail: string;
  ownerPassword: string;
  organisationName: string;
}) {
  const url = localEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = localEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const owner = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: ownerSignInError } = await owner.auth.signInWithPassword({
    email: input.ownerEmail,
    password: input.ownerPassword,
  });
  expect(ownerSignInError).toBeNull();

  const { data: organisation, error: organisationError } = await owner
    .from("organisations")
    .select("id")
    .eq("name", input.organisationName)
    .single();
  expect(organisationError).toBeNull();
  expect(organisation).not.toBeNull();

  const email = `digest-admin-${input.suffix}@example.test`;
  const password = testPassword(`admin:${input.suffix}`);
  const rawToken = createHash("sha256").update(`digest-admin-invite:${input.suffix}`).digest("base64url");
  const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
  const { error: invitationError } = await owner.rpc("issue_invitation", {
    target_organisation_id: organisation!.id,
    target_email: email,
    target_role: "admin",
    target_job_title: "Compliance administrator",
    new_token_hash: tokenHash,
    new_expires_at: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
  });
  expect(invitationError).toBeNull();

  const admin = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signUpError } = await admin.auth.signUp({
    email,
    password,
    options: { data: { display_name: "Digest Admin" } },
  });
  expect(signUpError).toBeNull();
  await confirmLocalUser(email);
  const { error: signInError } = await admin.auth.signInWithPassword({ email, password });
  expect(signInError).toBeNull();
  const { data: acceptedOrganisationId, error: acceptanceError } = await admin.rpc("accept_invitation", {
    raw_token: rawToken,
  });
  expect(acceptanceError).toBeNull();
  expect(acceptedOrganisationId).toBe(organisation!.id);

  return { email, password, organisationId: organisation!.id };
}

async function openSlackPanel(page: Page) {
  const panel = page.getByRole("region", { name: /^(Connect|Manage) Slack$/ });
  if (await panel.isVisible()) return panel;
  const card = page.getByRole("article", { name: "Slack connection" });
  const trigger = card.getByRole("button", { name: /^(Connect|Manage)$/ });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await expect(panel).toBeVisible();
  return panel;
}

function channelCard(panel: Locator, label: string) {
  return panel.locator(".connections-account", { hasText: label }).first();
}

async function addSlackChannel(page: Page, label: string, endpoint: string) {
  const panel = await openSlackPanel(page);
  await panel.getByLabel("Slack destination URL").fill(endpoint);
  await panel.getByLabel("Channel label").fill(label);
  await submitServerAction(page, panel.getByRole("button", { name: "Add Slack channel" }), "/app/integrations");
  await expect(channelCard(panel, label)).toBeVisible();
}

async function signOut(page: Page) {
  const navToggle = page.getByRole("button", { name: "Open navigation" });
  if (await navToggle.isVisible()) await navToggle.click();
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/"),
    page.getByRole("button", { name: "Sign out" }).click(),
  ]);
  await page.goto("/sign-in");
}

test("Owner controls the single Slack digest destination while Admin remains read-restricted", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const owner = await createOwnerWorkspace(page, testInfo);
  const admin = await createInvitedAdmin({
    suffix: owner.suffix,
    ownerEmail: owner.email,
    ownerPassword: owner.password,
    organisationName: owner.organisationName,
  });
  const compactSuffix = createHash("sha256").update(owner.suffix).digest("hex").slice(0, 10);
  const firstLabel = `#digest-primary-${compactSuffix}`;
  const secondLabel = `#digest-backup-${compactSuffix}`;
  const firstWebhook = `https://hooks.slack.com/services/T${compactSuffix}/BPRIMARY/secret-primary-${compactSuffix}`;
  const secondWebhook = `https://hooks.slack.com/services/T${compactSuffix}/BBACKUP/secret-backup-${compactSuffix}`;

  await page.goto("/app/integrations");
  await addSlackChannel(page, firstLabel, firstWebhook);
  await addSlackChannel(page, secondLabel, secondWebhook);

  let panel = await openSlackPanel(page);
  await submitServerAction(
    page,
    channelCard(panel, firstLabel).getByRole("button", { name: `Use ${firstLabel} for daily digest` }),
    "/app/integrations",
  );
  await expect(panel.getByText("Daily digest", { exact: true })).toHaveCount(1);
  await expect(channelCard(panel, firstLabel).getByText("Daily digest", { exact: true })).toBeVisible();

  // Seed a terminal delivery through the same service-role lifecycle RPCs the
  // Next server uses. This creates consistent parent and attempt history but
  // never starts the Slack transport or sends an external request.
  const service = serviceClient();
  const { data: reservation, error: reservationError } = await service.rpc("reserve_daily_digest_delivery_server", {
    target_organisation_id: admin.organisationId,
    target_actor_id: owner.userId,
    target_digest_on: "2026-08-07",
    target_fact_hash: "a".repeat(64),
    target_message: {
      text: "sensitive-test-message-must-not-render",
      blocks: [{ type: "section", text: { type: "plain_text", text: firstWebhook } }],
    },
  });
  expect(reservationError).toBeNull();
  expect(reservation).toMatchObject({ state: "reserved", attemptNumber: 1 });
  const deliveryId = (reservation as { deliveryId?: string } | null)?.deliveryId;
  expect(deliveryId).toBeTruthy();
  const { data: finalized, error: finalizeError } = await service.rpc("finalize_daily_digest_delivery_server", {
    target_delivery_id: deliveryId,
    target_actor_id: owner.userId,
    target_attempt_number: 1,
    target_outcome: "failed",
    target_error_code: "SLACK_REJECTED",
  });
  expect(finalizeError).toBeNull();
  expect(finalized).toBe(true);

  await submitServerAction(
    page,
    channelCard(panel, secondLabel).getByRole("button", { name: `Use ${secondLabel} for daily digest` }),
    "/app/integrations",
  );
  await expect(panel.getByText("Daily digest", { exact: true })).toHaveCount(1);
  await expect(channelCard(panel, secondLabel).getByText("Daily digest", { exact: true })).toBeVisible();
  await expect(channelCard(panel, firstLabel).getByText("Daily digest", { exact: true })).toHaveCount(0);

  await submitServerAction(
    page,
    channelCard(panel, secondLabel).getByRole("button", { name: "Stop daily digest" }),
    "/app/integrations",
  );
  await expect(panel.getByText("Daily digest", { exact: true })).toHaveCount(0);

  await page.reload();
  panel = await openSlackPanel(page);
  const history = panel.getByRole("region", { name: "Daily digest delivery history" });
  await expect(history.getByRole("heading", { name: "Recent daily digests" })).toBeVisible();
  await expect(history.getByText("Failed", { exact: true })).toBeVisible();
  await expect(history.getByText("Review code: SLACK_REJECTED", { exact: true })).toBeVisible();
  const lastAttempt = history.locator("time").filter({ hasText: /^Last attempt / });
  await expect(lastAttempt).toBeVisible();
  await expect(lastAttempt).toHaveAttribute("dateTime", /T/);
  await expect(history).not.toContainText("sensitive-test-message-must-not-render");
  await expect(history).not.toContainText(firstWebhook);

  await submitServerAction(
    page,
    channelCard(panel, firstLabel).getByRole("button", { name: `Use ${firstLabel} for daily digest` }),
    "/app/integrations",
  );
  await submitServerAction(
    page,
    channelCard(panel, firstLabel).getByRole("button", { name: `Pause ${firstLabel}` }),
    "/app/integrations",
  );
  await expect(channelCard(panel, firstLabel).getByText("Paused", { exact: true })).toBeVisible();
  await expect(panel.getByText("Daily digest", { exact: true })).toHaveCount(0);
  await submitServerAction(
    page,
    channelCard(panel, firstLabel).getByRole("button", { name: `Enable ${firstLabel}` }),
    "/app/integrations",
  );

  await submitServerAction(
    page,
    channelCard(panel, secondLabel).getByRole("button", { name: `Use ${secondLabel} for daily digest` }),
    "/app/integrations",
  );
  await submitServerAction(
    page,
    channelCard(panel, secondLabel).getByRole("button", { name: "Remove" }),
    "/app/integrations",
  );
  await expect(channelCard(panel, secondLabel)).toHaveCount(0);
  await expect(panel.getByText("Daily digest", { exact: true })).toHaveCount(0);

  await signOut(page);
  await page.getByLabel("Email").fill(admin.email);
  await page.getByLabel("Password").fill(admin.password);
  await Promise.all([
    page.waitForURL(/\/app(?:\/|$)/),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
  await page.goto("/app/integrations");
  panel = await openSlackPanel(page);
  await expect(channelCard(panel, firstLabel).getByRole("button", { name: `Pause ${firstLabel}` })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Add Slack channel" })).toBeVisible();
  await expect(panel.getByRole("button", { name: /daily digest/i })).toHaveCount(0);
  await expect(panel.getByRole("region", { name: "Daily digest delivery history" })).toHaveCount(0);
  await expect(panel).not.toContainText("SLACK_REJECTED");
});
