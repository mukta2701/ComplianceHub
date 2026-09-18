import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

function isLocalSupabaseUrl(value: string): boolean {
  return /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(value);
}

function requiredEnvironment(
  name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY" | "SUPABASE_SERVICE_ROLE_KEY" | "NEXT_PUBLIC_SITE_URL",
): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be explicitly configured for the GitHub connection end-to-end test`);
  return value;
}

function assertLocalTestEnvironment(): void {
  const configuredUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  if (!isLocalSupabaseUrl(configuredUrl)) {
    throw new Error("The GitHub connection end-to-end test refuses non-local Supabase projects");
  }
  const port = process.env.PLAYWRIGHT_PORT ?? "3100";
  if (!/^\d+$/.test(port) || requiredEnvironment("NEXT_PUBLIC_SITE_URL") !== `http://127.0.0.1:${port}`) {
    throw new Error("NEXT_PUBLIC_SITE_URL must match the local Playwright origin");
  }
}

function serviceClient(): SupabaseClient {
  return createClient(
    requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function testPassword(seed: string): string {
  return `E2e-${createHash("sha256").update(seed).digest("hex").slice(0, 24)}-Aa1!`;
}

async function confirmLocalUser(email: string): Promise<string> {
  const service = serviceClient();
  const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1_000 });
  if (error) throw error;
  const userId = data.users.find((user) => user.email === email)?.id ?? null;
  if (!userId) throw new Error("Synthetic GitHub connection user was not found");
  const { error: confirmError } = await service.auth.admin.updateUserById(userId, { email_confirm: true });
  if (confirmError) throw confirmError;
  return userId;
}

async function signUpUser(page: Page, email: string, name: string): Promise<string> {
  const password = testPassword(email);
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
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
  return userId;
}

async function createWorkspace(page: Page, organisationName: string): Promise<string> {
  await expect(page.getByRole("heading", { name: "Create your organisation" })).toBeVisible();
  await page.getByLabel("Organisation name").fill(organisationName);
  const [workspaceResponse] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/app"),
    page.getByRole("button", { name: "Create workspace" }).click(),
  ]);
  expect(workspaceResponse.status()).toBeLessThan(400);
  await expect(page.getByRole("heading", { name: "Programme overview" })).toBeVisible();
  const { data: organisation, error } = await serviceClient()
    .from("organisations")
    .select("id")
    .eq("name", organisationName)
    .single();
  if (error || !organisation) throw error ?? new Error("Synthetic organisation was not found");
  return (organisation as { id: string }).id;
}

test.describe("GitHub connection milestone", () => {
  test.beforeAll(() => {
    assertLocalTestEnvironment();
  });

  test("Owner manages scope, Admin reads health, Member reads without controls", async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const compact = createHash("sha256")
      .update(`connection-milestone:${Date.now()}:${testInfo.project.name}:${testInfo.retry}`)
      .digest("hex")
      .slice(0, 10);
    const service = serviceClient();
    const providerBase = Number.parseInt(
      createHash("sha256").update(`provider:${compact}`).digest("hex").slice(0, 7),
      16,
    );
    const providerInstallationId = providerBase + 11;
    const providerAccountId = providerBase + 12;
    const portalRepositoryId = providerBase + 21;
    const legacyRepositoryId = providerBase + 22;

    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const ownerEmail = `github-connection-owner-${compact}@example.test`;
    const ownerId = await signUpUser(ownerPage, ownerEmail, "Connection Owner");
    const organisationId = await createWorkspace(ownerPage, `GitHub Connection ${compact}`);

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const adminEmail = `github-connection-admin-${compact}@example.test`;
    const adminId = await signUpUser(adminPage, adminEmail, "Connection Admin");
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    const memberEmail = `github-connection-member-${compact}@example.test`;
    const memberId = await signUpUser(memberPage, memberEmail, "Connection Member");
    const { error: membershipError } = await service.from("memberships").insert([
      { organisation_id: organisationId, user_id: adminId, role: "admin" },
      { organisation_id: organisationId, user_id: memberId, role: "member" },
    ]);
    expect(membershipError).toBeNull();

    // The Admin empty-state message before any installation exists must not imply management.
    await adminPage.goto("/app/monitoring");
    await expect(adminPage.getByText("GitHub is not connected. Ask a workspace Owner to connect GitHub.")).toBeVisible();
    await expect(adminPage.getByRole("link", { name: "Connect GitHub" })).toHaveCount(0);

    const repositoryPayload = (providerId: number, name: string) => ({
      id: providerId,
      owner: "Example-Co",
      name,
      fullName: `Example-Co/${name}`,
      htmlUrl: `https://github.com/Example-Co/${name}`,
      visibility: "private",
      archived: false,
      defaultBranch: "main",
    });
    const { data: claimedInstallationId, error: claimError } = await service.rpc("claim_github_installation_server", {
      target_organisation_id: organisationId,
      target_actor_id: ownerId,
      target_provider_installation_id: providerInstallationId,
      target_account_id: providerAccountId,
      target_account_login: "Example-Co",
      target_account_type: "Organization",
      target_repository_selection: "selected",
      target_permissions: {
        actions: "read",
        administration: "read",
        metadata: "read",
        secret_scanning_alerts: "read",
        security_events: "read",
        vulnerability_alerts: "read",
      },
      target_permissions_ok: true,
      target_repositories: [repositoryPayload(portalRepositoryId, "portal"), repositoryPayload(legacyRepositoryId, "legacy")],
    });
    expect(claimError).toBeNull();
    expect(typeof claimedInstallationId).toBe("string");

    // Owner: plain-language status, exact permissions, scope totals, management controls.
    await ownerPage.goto("/app/integrations");
    const installation = ownerPage.getByRole("article", { name: "Example-Co GitHub installation" });
    await expect(installation.getByText("Healthy")).toBeVisible();
    await expect(installation.getByText(/Approved read-only access:/)).toBeVisible();
    await expect(installation.getByText("2 repositories · 0 selected · 2 available")).toBeVisible();
    await expect(ownerPage.getByRole("link", { name: "Manage repository access" })).toHaveAttribute("href", "/api/github/setup");
    await expect(ownerPage.getByRole("button", { name: "Disconnect" })).toBeVisible();
    expect(await new AxeBuilder({ page: ownerPage })
      .include('article[aria-label="Example-Co GitHub installation"]')
      .analyze()).toEqual(
      expect.objectContaining({ violations: [] }),
    );

    // Owner selects the pilot repository through the real scope control.
    await installation.getByRole("checkbox", { name: /include Example-Co\/portal in monitoring/ }).check();
    await expect(ownerPage.getByRole("status")).toContainText("Repository scope updated.", { timeout: 15_000 });
    await expect(installation.getByText("2 repositories · 1 selected · 2 available")).toBeVisible();

    // A genuine partial reconciliation retires the legacy repository.
    const workerHex = createHash("sha256").update(`worker:${compact}`).digest("hex");
    const workerId = `${workerHex.slice(0, 8)}-${workerHex.slice(8, 12)}-4${workerHex.slice(13, 16)}-8${workerHex.slice(17, 20)}-${workerHex.slice(20, 32)}`;
    const { data: dueRuns, error: dueError } = await service.rpc("claim_due_github_connection_reconciliations_server", {
      target_worker_id: workerId,
      target_limit: 10,
      target_now: new Date().toISOString(),
    });
    expect(dueError).toBeNull();
    const ownRuns = (dueRuns as Array<{ id: string; organisation_id: string }>).filter(
      (run) => run.organisation_id === organisationId,
    );
    expect(ownRuns).toHaveLength(1);
    const runId = ownRuns[0]?.id;
    const { error: finalizeError } = await service.rpc("finalize_github_connection_reconciliation_server", {
      target_run_id: runId,
      target_worker_id: workerId,
      target_outcome: "partial",
      target_diagnostic_code: "repository_unavailable",
      target_next_attempt_at: null,
      target_repository_snapshot: [repositoryPayload(portalRepositoryId, "portal")],
    });
    expect(finalizeError).toBeNull();
    await ownerPage.reload();
    await expect(installation.getByText("Partly unavailable")).toBeVisible();
    await expect(installation.getByText("2 repositories · 1 selected · 1 available")).toBeVisible();

    // A changed provider state surfaces as Owner action without inventing success.
    const { data: dueRuns2, error: dueError2 } = await service.rpc("claim_due_github_connection_reconciliations_server", {
      target_worker_id: workerId,
      target_limit: 10,
      target_now: new Date(Date.now() + 6 * 60_000).toISOString(),
    });
    expect(dueError2).toBeNull();
    const ownRuns2 = (dueRuns2 as Array<{ id: string; organisation_id: string }>).filter(
      (run) => run.organisation_id === organisationId,
    );
    expect(ownRuns2).toHaveLength(1);
    const runId2 = ownRuns2[0]?.id;
    const { error: actionError } = await service.rpc("finalize_github_connection_reconciliation_server", {
      target_run_id: runId2,
      target_worker_id: workerId,
      target_outcome: "action_required",
      target_diagnostic_code: "permission_mismatch",
      target_next_attempt_at: null,
      target_repository_snapshot: null,
    });
    expect(actionError).toBeNull();
    await ownerPage.reload();
    await expect(installation.getByText("Owner action required")).toBeVisible();
    await expect(installation.getByText(/permission may have changed/i)).toBeVisible();
    await expect(installation.getByText(/Next step:/)).toBeVisible();

    // Admin: health facts without management controls.
    await adminPage.goto("/app/integrations");
    const adminInstallation = adminPage.getByRole("article", { name: "Example-Co GitHub installation" });
    await expect(adminInstallation.getByText("Owner action required")).toBeVisible();
    await expect(adminPage.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
    await expect(adminPage.getByRole("link", { name: "Manage repository access" })).toHaveCount(0);
    await expect(adminPage.getByText("Only workspace Owners can set up or manage repository access.")).toBeVisible();

    // Member: redirected away from configuration without management controls.
    await memberPage.goto("/app/integrations");
    await expect.poll(async () => new URL(memberPage.url()).pathname, { timeout: 10_000 }).not.toBe("/app/integrations");
    await expect(memberPage.getByRole("heading", { name: "GitHub repository access" })).toHaveCount(0);
    await expect(memberPage.getByRole("button", { name: "Disconnect" })).toHaveCount(0);
    await expect(memberPage.getByRole("link", { name: "Manage repository access" })).toHaveCount(0);

    // Owner disconnect takes two deliberate clicks and never claims provider removal.
    await ownerPage.bringToFront();
    await ownerPage.getByRole("button", { name: "Disconnect" }).click();
    await ownerPage.getByRole("button", { name: "Click again to confirm disconnect" }).click();
    await expect(ownerPage.getByText(/GitHub-side installation is unchanged/i)).toBeVisible({ timeout: 15_000 });
    await ownerPage.reload();
    await expect(ownerPage.getByRole("article", { name: "Example-Co GitHub installation" }).getByText("Disconnected", { exact: true })).toBeVisible();
    await expect(ownerPage.getByRole("button", { name: "Disconnect" })).toHaveCount(0);

    await ownerContext.close();
    await adminContext.close();
    await memberContext.close();
  });
});
