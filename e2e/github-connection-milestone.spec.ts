import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { createTeamFixture, signIn, teamTestEnabled } from "./helpers/team-workspace";

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

test("fictional GitHub connection health is usable on desktop and mobile", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const fixture = await createTeamFixture();
  const service = createClient(
    "http://127.0.0.1:55321",
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const providerInstallationId = Number(`8${Date.now().toString().slice(-11)}`);
  const accountLogin = `fictional-${randomUUID().slice(0, 8)}`;
  const { data: installationId, error: claimError } = await service.rpc("claim_github_installation_server", {
    target_organisation_id: fixture.organisationId,
    target_actor_id: fixture.actors[0].id,
    target_provider_installation_id: providerInstallationId,
    target_account_id: providerInstallationId + 1,
    target_account_login: accountLogin,
    target_account_type: "Organization",
    target_repository_selection: "selected",
    target_permissions: permissions,
    target_permissions_ok: true,
    target_repositories: ["pilot", "available", "historical"].map((name, index) => ({
      id: providerInstallationId + 10 + index,
      owner: accountLogin,
      name,
      fullName: `${accountLogin}/${name}`,
      htmlUrl: `https://github.com/${accountLogin}/${name}`,
      visibility: "private",
      archived: false,
      defaultBranch: "main",
    })),
  });
  expect(claimError).toBeNull();
  if (typeof installationId !== "string") throw new Error("Fictional GitHub installation was not created");

  const { error: statusError } = await service.from("github_installations").update({
    health: "healthy",
    health_diagnostic_code: null,
    last_successful_reconciliation_at: "2026-09-15T11:55:00.000Z",
  }).eq("id", installationId).eq("organisation_id", fixture.organisationId);
  if (statusError) throw statusError;
  const { error: scopeError } = await service.from("github_repositories")
    .update({ selected: true })
    .eq("installation_id", installationId)
    .eq("organisation_id", fixture.organisationId)
    .eq("name", "pilot");
  if (scopeError) throw scopeError;
  const { error: historyError } = await service.from("github_repositories")
    .update({ available: false, selected: false })
    .eq("installation_id", installationId)
    .eq("organisation_id", fixture.organisationId)
    .eq("name", "historical");
  if (historyError) throw historyError;

  await signIn(page, fixture.actors[0]);
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 393, height: 851 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/app/integrations");
    const panel = page.getByRole("region", { name: "GitHub repository access" });
    await expect(panel.getByText("Healthy", { exact: true })).toBeVisible();
    await expect(panel.getByText("GitHub is connected and was checked", { exact: false })).toBeVisible();
    await expect(panel.getByText("2 repositories available to this GitHub App; 1 selected in ComplianceHub.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Disconnect from ComplianceHub" })).toBeVisible();
    const status = panel.getByRole("status");
    await expect(status).toHaveAttribute("aria-live", "polite");
    await panel.getByRole("link", { name: "Open GitHub installation settings" }).focus();
    await expect(panel.getByRole("link", { name: "Open GitHub installation settings" })).toBeFocused();
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`github-connection-${viewport.width}.png`), fullPage: true });
  }
});
