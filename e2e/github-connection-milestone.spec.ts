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
    target_repositories: initialRepositories,
  });
  expect(claimError).toBeNull();
  if (typeof installationId !== "string") throw new Error("Fictional GitHub installation was not created");

  const { data: repositories, error: repositoryError } = await service.from("github_repositories")
    .select("id,name")
    .eq("installation_id", installationId)
    .eq("organisation_id", fixture.organisationId);
  if (repositoryError) throw repositoryError;
  const pilot = repositories?.filter((repository) => repository.name === "pilot") ?? [];
  if (pilot.length !== 1) throw new Error("Fictional pilot repository was not found exactly once");
  const { data: selectionResult, error: selectionError } = await fixture.coordinator.rpc("set_github_repository_selected", {
    target_repository_id: pilot[0].id,
    target_selected: true,
  });
  expect(selectionError).toBeNull();
  expect(selectionResult).toBe(true);

  const workerId = randomUUID();
  const now = new Date().toISOString();
  const { data: claimedRuns, error: claimRunError } = await service.rpc("claim_due_github_connection_reconciliations_server", {
    target_worker_id: workerId,
    target_limit: 100,
    target_now: now,
  });
  if (claimRunError || !Array.isArray(claimedRuns)) throw claimRunError ?? new Error("Fictional reconciliation runs were not claimed");
  const matchingRuns = claimedRuns.filter((run) => run.installation_id === installationId);
  if (matchingRuns.length !== 1) throw new Error("Fictional installation reconciliation run was not claimed exactly once");
  const { data: finalization, error: finalizationError } = await service.rpc("finalize_github_connection_reconciliation_server", {
    target_run_id: matchingRuns[0].id,
    target_worker_id: workerId,
    target_outcome: "success",
    target_diagnostic_code: null,
    target_next_attempt_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    target_repository_snapshot: canonicalRepositories,
  });
  expect(finalizationError).toBeNull();
  expect(finalization).toMatchObject({ effectiveHealth: "healthy", incidentTransition: "none" });

  await signIn(page, fixture.actors[0]);
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 393, height: 851 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/app/integrations");
    const panel = page.getByRole("region", { name: "GitHub repository access" });
    await expect(panel.getByText("Healthy", { exact: true })).toBeVisible();
    const healthStatus = panel.getByText("GitHub is connected and was checked", { exact: false });
    await expect(healthStatus).toBeVisible();
    await expect(panel.getByText("2 repositories available to this GitHub App; 1 selected in ComplianceHub.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Disconnect from ComplianceHub" })).toBeVisible();
    await expect(healthStatus).toHaveAttribute("aria-live", "polite");
    await panel.getByRole("link", { name: "Open GitHub installation settings" }).focus();
    await expect(panel.getByRole("link", { name: "Open GitHub installation settings" })).toBeFocused();
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`github-connection-${viewport.width}.png`), fullPage: true });
  }
});
