import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { clientFor, signIn, teamTestEnabled, type Actor } from "./helpers/team-workspace";

const isolatedApi = "http://127.0.0.1:55321";
const enabled = teamTestEnabled && process.env.COMPLIANCEHUB_UI_DEMO === "1";
test.skip(!enabled, "Set COMPLIANCEHUB_UI_DEMO=1 against the isolated fictional local workspace.");

const permissions = {
  metadata: "read",
  administration: "read",
  actions: "read",
  vulnerability_alerts: "read",
  security_events: "read",
  secret_scanning_alerts: "read",
} as const;

type ConnectionFixture = {
  actors: { owner: Actor; admin: Actor; member: Actor };
  organisationId: string;
  owner: SupabaseClient;
  service: SupabaseClient;
};

async function createConnectionFixture(): Promise<ConnectionFixture> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Isolated local fixture credentials required");
  const service = createClient(isolatedApi, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const suffix = randomUUID().slice(0, 8);
  const actors = {} as ConnectionFixture["actors"];
  for (const role of ["owner", "admin", "member"] as const) {
    const password = `Fictional-${randomBytes(18).toString("base64url")}!A9`;
    const { data, error } = await service.auth.admin.createUser({
      email: `github-health-${role}-${suffix}@example.test`,
      password,
      email_confirm: true,
      user_metadata: { display_name: `GitHub health ${role}` },
    });
    if (error || !data.user) throw new Error(`Could not create fictional ${role}`);
    actors[role] = { id: data.user.id, email: data.user.email!, password };
  }
  const owner = await clientFor(actors.owner);
  const { data: organisationId, error: organisationError } = await owner.rpc("create_organisation_with_owner", {
    organisation_name: `GitHub health demonstration ${suffix}`,
    organisation_slug: `github-health-${suffix}`,
  });
  if (organisationError || typeof organisationId !== "string") throw organisationError ?? new Error("Could not create fictional workspace");
  const { error: membershipError } = await service.from("memberships").insert([
    { organisation_id: organisationId, user_id: actors.admin.id, role: "admin" },
    { organisation_id: organisationId, user_id: actors.member.id, role: "member" },
  ]);
  if (membershipError) throw membershipError;
  return { actors, organisationId, owner, service };
}

async function assertNoUnrelatedDueOrLeasedReconciliations(input: {
  service: SupabaseClient;
  claimAt: string;
  installationId: string;
}) {
  const claimAt = Date.parse(input.claimAt);
  const { data, error } = await input.service.from("github_installations")
    .select("id,next_reconciliation_at,reconciliation_locked_by,reconciliation_locked_until");
  if (error) throw error;
  const unsafe = (data ?? []).filter((installation) => {
    if (installation.id === input.installationId) return false;
    const dueAt = installation.next_reconciliation_at === null
      ? Number.NaN
      : Date.parse(installation.next_reconciliation_at);
    return (Number.isFinite(dueAt) && dueAt <= claimAt)
      || installation.reconciliation_locked_by !== null
      || installation.reconciliation_locked_until !== null;
  });
  if (unsafe.length > 0) throw new Error("Refusing to claim reconciliation work while unrelated local work is due or leased");
}

async function focusByTab(page: Page, locator: Locator) {
  for (let attempts = 0; attempts < 40; attempts += 1) {
    await page.keyboard.press("Tab");
    if (await locator.evaluate((element) => document.activeElement === element)) return;
  }
  throw new Error("Could not reach the GitHub installation link by keyboard Tab traversal");
}

test("fictional GitHub connection health is usable on desktop and mobile", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const fixture = await createConnectionFixture();
  const { service } = fixture;

  const providerInstallationId = Number(`8${Date.now().toString().slice(-11)}`);
  const accountLogin = `fictional-${randomUUID().slice(0, 8)}`;
  const canonicalRepositories = ["pilot", "available"].map((name, index) => ({
    id: providerInstallationId + 10 + index,
    owner: accountLogin,
    name,
    fullName: `${accountLogin}/${name}`,
    htmlUrl: `https://github.com/${accountLogin}/${name}`,
    visibility: "private",
    archived: false,
    defaultBranch: "main",
  }));
  const initialRepositories = [...canonicalRepositories, {
    id: providerInstallationId + 12,
    owner: accountLogin,
    name: "historical",
    fullName: `${accountLogin}/historical`,
    htmlUrl: `https://github.com/${accountLogin}/historical`,
    visibility: "private",
    archived: false,
    defaultBranch: "main",
  }];
  let installationId: string | null = null;

  try {
    const { data, error: claimError } = await service.rpc("claim_github_installation_server", {
      target_organisation_id: fixture.organisationId,
      target_actor_id: fixture.actors.owner.id,
      target_provider_installation_id: providerInstallationId,
      target_account_id: providerInstallationId + 1,
      target_account_login: accountLogin,
      target_account_type: "Organization",
      target_repository_selection: "selected",
      target_permissions: permissions,
      target_permissions_ok: true,
      target_repositories: initialRepositories,
    });
    expect(claimError).toBeNull();
    if (typeof data !== "string") throw new Error("Fictional GitHub installation was not created");
    installationId = data;

    const { data: repositories, error: repositoryError } = await service.from("github_repositories")
      .select("id,name")
      .eq("installation_id", installationId)
      .eq("organisation_id", fixture.organisationId);
    if (repositoryError) throw repositoryError;
    const pilot = repositories?.filter((repository) => repository.name === "pilot") ?? [];
    if (pilot.length !== 1) throw new Error("Fictional pilot repository was not found exactly once");
    const { data: selectionResult, error: selectionError } = await fixture.owner.rpc("set_github_repository_selected", {
      target_repository_id: pilot[0].id,
      target_selected: true,
    });
    expect(selectionError).toBeNull();
    expect(selectionResult).toBe(true);

    const workerId = randomUUID();
    const claimAt = new Date().toISOString();
    await assertNoUnrelatedDueOrLeasedReconciliations({ service, claimAt, installationId });
    const { data: claimedRuns, error: claimRunError } = await service.rpc("claim_due_github_connection_reconciliations_server", {
      target_worker_id: workerId,
      target_limit: 1,
      target_now: claimAt,
    });
    if (claimRunError || !Array.isArray(claimedRuns) || claimedRuns.length !== 1 || claimedRuns[0]?.installation_id !== installationId) {
      throw claimRunError ?? new Error("Only the new fictional installation reconciliation run must be claimed");
    }
    const { data: finalization, error: finalizationError } = await service.rpc("finalize_github_connection_reconciliation_server", {
      target_run_id: claimedRuns[0].id,
      target_worker_id: workerId,
      target_outcome: "success",
      target_diagnostic_code: null,
      target_next_attempt_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      target_repository_snapshot: canonicalRepositories,
    });
    expect(finalizationError).toBeNull();
    expect(finalization).toMatchObject({ effectiveHealth: "healthy", incidentTransition: "none" });

    await signIn(page, fixture.actors.owner);
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 393, height: 851 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/app/integrations");
      const panel = page.getByRole("region", { name: "GitHub repository access" });
      const healthStatus = panel.getByText("GitHub is connected and was checked", { exact: false });
      await expect(panel.getByText("Healthy", { exact: true })).toBeVisible();
      await expect(healthStatus).toHaveAttribute("aria-live", "polite");
      await expect(panel.getByText("2 repositories available to this GitHub App; 1 selected in ComplianceHub.")).toBeVisible();
      const management = panel.getByRole("group", { name: "GitHub installation details and Owner actions" });
      const historicalDetail = management.getByText("1 historical repository is unavailable and cannot be selected.", { exact: true });
      const settingsLink = panel.getByRole("link", { name: "Open GitHub installation settings" });
      const disconnectButton = panel.getByRole("button", { name: "Disconnect from ComplianceHub" });
      await expect(historicalDetail).toBeVisible();
      await expect(disconnectButton).toBeVisible();
      expect(await management.evaluate((group) => Array.from(group.children).map((child) => ({
        tagName: child.tagName,
        text: child.textContent?.trim(),
      })))).toEqual([
        { tagName: "P", text: "1 historical repository is unavailable and cannot be selected." },
        { tagName: "A", text: "Open GitHub installation settings" },
        { tagName: "BUTTON", text: "Disconnect from ComplianceHub" },
      ]);
      const configurationNote = panel.getByText("2 repositories available to this GitHub App; 1 selected in ComplianceHub.", { exact: true });
      const pilotRepository = panel.getByRole("article", { name: `${accountLogin}/pilot repository scope` });
      const [managementBox, noteBox, repositoryBox, settingsBox, disconnectBox] = await Promise.all([
        management.boundingBox(),
        configurationNote.boundingBox(),
        pilotRepository.boundingBox(),
        settingsLink.boundingBox(),
        disconnectButton.boundingBox(),
      ]);
      if (!managementBox || !noteBox || !repositoryBox || !settingsBox || !disconnectBox) {
        throw new Error("GitHub installation details and controls must have layout boxes");
      }
      expect(settingsBox.height).toBeGreaterThanOrEqual(44);
      expect(disconnectBox.height).toBeGreaterThanOrEqual(44);
      if (viewport.width > 640) {
        expect(Math.abs(managementBox.x - noteBox.x)).toBeLessThanOrEqual(4);
        expect(Math.abs(managementBox.x - (repositoryBox.x + 24))).toBeLessThanOrEqual(4);
        expect(Math.abs((managementBox.x + managementBox.width) - (noteBox.x + noteBox.width))).toBeLessThanOrEqual(4);
        expect(Math.abs((managementBox.x + managementBox.width) - (repositoryBox.x + repositoryBox.width - 24))).toBeLessThanOrEqual(4);
      } else {
        expect(Math.abs(settingsBox.x - managementBox.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(disconnectBox.x - managementBox.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(settingsBox.width - managementBox.width)).toBeLessThanOrEqual(2);
        expect(Math.abs(disconnectBox.width - managementBox.width)).toBeLessThanOrEqual(2);
        expect(settingsBox.y + settingsBox.height).toBeLessThanOrEqual(disconnectBox.y);
      }
      await focusByTab(page, settingsLink);
      const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(widths.scroll).toBeLessThanOrEqual(widths.client);
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`github-connection-${viewport.width}.png`), fullPage: true });
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    }

    await page.context().clearCookies();
    await signIn(page, fixture.actors.admin);
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 393, height: 851 }]) {
      await page.setViewportSize(viewport);
      await page.goto("/app/integrations");
      const panel = page.getByRole("region", { name: "GitHub repository access" });
      await expect(panel.getByText("Healthy", { exact: true })).toBeVisible();
      await expect(panel.getByText("2 repositories available to this GitHub App; 1 selected in ComplianceHub.")).toBeVisible();
      const details = panel.getByRole("group", { name: "GitHub installation details" });
      await expect(details.getByText("1 historical repository is unavailable and cannot be selected.", { exact: true })).toBeVisible();
      await expect(details.getByRole("link", { name: "Open GitHub installation settings" })).toHaveCount(0);
      await expect(details.getByRole("button", { name: "Disconnect from ComplianceHub" })).toHaveCount(0);
      for (const label of [
        "Metadata — read",
        "Administration — read",
        "Actions — read",
        "Vulnerability alerts — read",
        "Security events — read",
        "Secret scanning alerts — read",
      ]) await expect(panel.getByText(label)).toBeVisible();
      await expect(panel.getByRole("checkbox")).toHaveCount(0);
      await expect(panel.getByRole("button", { name: "Disconnect from ComplianceHub" })).toHaveCount(0);
      await expect(panel.getByRole("link", { name: "Manage repository access" })).toHaveCount(0);
      await expect(panel.getByRole("link", { name: "Open GitHub installation settings" })).toHaveCount(0);
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    }

    await page.context().clearCookies();
    await signIn(page, fixture.actors.member);
    await page.goto("/app/integrations");
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.getByRole("region", { name: "GitHub repository access" })).toHaveCount(0);
    await expect(page.getByText(/GitHub App permissions no longer match/i)).toHaveCount(0);

    await page.context().clearCookies();
    await signIn(page, fixture.actors.owner);
    await page.goto("/app/integrations");
    const ownerPanel = page.getByRole("region", { name: "GitHub repository access" });
    await ownerPanel.getByRole("button", { name: "Disconnect from ComplianceHub" }).click();
    const disconnectStatus = ownerPanel.getByText(
      "ComplianceHub is disconnected. Its GitHub App installation was not removed from GitHub.",
      { exact: true },
    );
    await expect(disconnectStatus).toHaveAttribute("aria-live", "polite");
    await expect(ownerPanel.getByText("Disconnected", { exact: true })).toBeVisible();
  } finally {
    if (installationId) {
      const { data: disconnected, error: disconnectError } = await fixture.owner.rpc("disconnect_github_installation", {
        target_installation_id: installationId,
      });
      if (disconnectError || (disconnected !== true && disconnected !== false)) {
        throw disconnectError ?? new Error("Could not safely disconnect the fictional GitHub installation");
      }
      const { data: installation, error: cleanupReadError } = await service.from("github_installations")
        .select("next_reconciliation_at,reconciliation_locked_by,reconciliation_locked_until")
        .eq("id", installationId)
        .maybeSingle();
      if (cleanupReadError || !installation) throw cleanupReadError ?? new Error("Could not verify fictional installation cleanup");
      expect(installation).toMatchObject({
        next_reconciliation_at: null,
        reconciliation_locked_by: null,
        reconciliation_locked_until: null,
      });
    }
  }
});
