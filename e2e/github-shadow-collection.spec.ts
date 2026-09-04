import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import type { GitHubFactSet, GitHubObservation } from "../src/features/github/domain/observation";
import { evaluateGitHubRepository, EXPECTED_GITHUB_CHECK_IDS } from "../src/features/github/domain/rules";
import {
  runGitHubCollection,
  type CollectionDependencies,
  type CollectionSummary,
  type CollectionTarget,
  type RunReservation,
  type RunResult,
} from "../src/features/github/application/run-collection";

const REQUIRED_PERMISSIONS = {
  actions: "read",
  administration: "read",
  metadata: "read",
  secret_scanning_alerts: "read",
  security_events: "read",
  vulnerability_alerts: "read",
} as const;

function isLocalSupabaseUrl(value: string): boolean {
  return /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(value);
}

function requiredEnvironment(
  name: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_ANON_KEY" | "SUPABASE_SERVICE_ROLE_KEY" | "NEXT_PUBLIC_SITE_URL",
): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be explicitly configured for the GitHub shadow end-to-end test`);
  return value;
}

function activeLocalSupabaseUrl(): string {
  const output = execFileSync("npx", ["supabase", "status", "-o", "env"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const apiUrl = output.split("\n")
    .map((line) => /^API_URL="?(.*?)"?$/.exec(line)?.[1])
    .find((value): value is string => Boolean(value));
  if (!apiUrl) throw new Error("API_URL is required from the running local Supabase stack");
  return apiUrl;
}

function assertLocalTestEnvironment(): void {
  const configuredUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  if (!isLocalSupabaseUrl(configuredUrl)) {
    throw new Error("The GitHub shadow end-to-end test refuses non-local Supabase projects");
  }
  if (configuredUrl !== activeLocalSupabaseUrl()) {
    throw new Error("The application and test must use the same running local Supabase stack");
  }
  requiredEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
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
  let userId: string | null = null;
  for (let page = 1; page <= 10 && userId === null; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1_000 });
    if (error) throw error;
    userId = data.users.find((user) => user.email === email)?.id ?? null;
    if (data.users.length < 1_000) break;
  }
  if (!userId) throw new Error("Synthetic GitHub shadow user was not found");
  const { error } = await service.auth.admin.updateUserById(userId, { email_confirm: true });
  if (error) throw error;
  return userId;
}

async function createOwnerWorkspace(page: Page, testInfo: TestInfo) {
  const compact = createHash("sha256")
    .update(`${Date.now()}:${testInfo.project.name}:${testInfo.retry}`)
    .digest("hex")
    .slice(0, 10);
  const email = `github-shadow-${compact}@example.test`;
  const password = testPassword(compact);
  const organisationName = `GitHub Shadow ${compact}`;

  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("GitHub Shadow Owner");
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
  await expect(page.getByRole("heading", { name: "Create your organisation" })).toBeVisible();
  await page.getByLabel("Organisation name").fill(organisationName);
  const [workspaceResponse] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/app"),
    page.getByRole("button", { name: "Create workspace" }).click(),
  ]);
  expect(workspaceResponse.status()).toBeLessThan(400);
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();

  const { data: organisation, error } = await serviceClient()
    .from("organisations")
    .select("id")
    .eq("name", organisationName)
    .single();
  if (error || !organisation) throw error ?? new Error("Synthetic organisation was not found");
  return { compact, userId, organisationId: organisation.id as string };
}

function providerBase(testInfo: TestInfo): number {
  const projectOffset = Number.parseInt(
    createHash("sha256").update(testInfo.project.name).digest("hex").slice(0, 5),
    16,
  );
  return Date.now() * 1_000 + projectOffset;
}

async function selectRepository(page: Page, repositoryName: string) {
  const repository = page.getByRole("article", { name: `${repositoryName} repository scope` });
  const checkbox = repository.getByRole("checkbox", {
    name: `Allow ComplianceHub to read and include ${repositoryName} in monitoring`,
  });
  await expect(checkbox).not.toBeChecked();
  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST" && new URL(candidate.url()).pathname === "/app/integrations",
  );
  await checkbox.check();
  expect((await response).status()).toBeLessThan(400);
  await expect(page.getByRole("status")).toContainText("Repository scope updated.");
  await expect(checkbox).toBeChecked();
}

type RepositorySeed = {
  id: string;
  provider_repository_id: number;
  owner_login: string;
  name: string;
  full_name: string;
  html_url: string;
};

function sanitisedFacts(repository: RepositorySeed, input: { partial: boolean; failOne: boolean }): GitHubFactSet {
  const available = <T,>(value: T) => ({ state: "available" as const, value });
  return {
    repository: {
      id: repository.provider_repository_id,
      owner: repository.owner_login,
      name: repository.name,
      visibility: input.failOne ? "public" : "private",
      archived: false,
      defaultBranch: "main",
      url: repository.html_url,
    },
    branchProtection: input.partial
      ? { state: "unavailable", diagnosticCode: "permission_denied" }
      : available({
          forcePushesBlocked: true,
          deletionsBlocked: true,
          approvingReviews: 2,
          dismissesStaleReviews: true,
          codeOwnerReviews: true,
          requiredStatusChecks: ["test"],
        }),
    dependabot: available({ openHigh: 0, openCritical: 0 }),
    codeScanning: available({ openHigh: 0, openCritical: 0 }),
    secretScanningConfiguration: available({ enabled: true }),
    secretScanningPushProtection: available({ enabled: true }),
    secretScanningAlerts: available({ openAlerts: 0 }),
    securityWorkflows: available([{
      name: "CodeQL",
      approved: true,
      active: true,
      latestConclusion: "success",
    }]),
    administration: available({ outsideCollaboratorAdmins: 0 }),
  };
}

function toReservation(value: unknown, target: CollectionTarget): RunReservation {
  const row = (Array.isArray(value) ? value[0] : value) as Record<string, unknown> | null;
  if (!row) throw new Error("The local collection reservation was not returned");
  const reservation: RunReservation = {
    runId: String(row.run_id),
    leaseToken: String(row.lease_token),
    leaseExpiresAt: String(row.lease_expires_at),
    attempt: Number(row.attempt),
    runMode: "official",
    acquisitionState: String(row.acquisition_state) as RunReservation["acquisitionState"],
    status: String(row.status) as RunReservation["status"],
    organisationId: String(row.organisation_id),
    installationId: String(row.installation_id),
    repositoryId: String(row.repository_id),
    providerRepositoryId: Number(row.provider_repository_id),
  };
  expect(reservation).toMatchObject({
    acquisitionState: "acquired",
    status: "running",
    organisationId: target.organisationId,
    installationId: target.installationId,
    repositoryId: target.repositoryId,
    providerRepositoryId: target.providerRepositoryId,
  });
  expect(reservation.runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(reservation.leaseToken).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(Number.isSafeInteger(reservation.attempt) && reservation.attempt > 0).toBe(true);
  expect(Number.isFinite(Date.parse(reservation.leaseExpiresAt))).toBe(true);
  return reservation;
}

async function completeCollection(
  service: SupabaseClient,
  input: {
    organisationId: string;
    installationId: string;
    providerInstallationId: number;
    repository: RepositorySeed;
    requestKey: string;
    status: "succeeded" | "partial";
    failOne?: boolean;
  },
): Promise<{ runId: string; summary: CollectionSummary }> {
  const target: CollectionTarget = {
    organisationId: input.organisationId,
    installationId: input.installationId,
    repositoryId: input.repository.id,
    providerInstallationId: input.providerInstallationId,
    providerRepositoryId: input.repository.provider_repository_id,
    owner: input.repository.owner_login,
    name: input.repository.name,
  };
  let runId: string | undefined;
  let factCollections = 0;
  const dependencies: CollectionDependencies = {
    listTargets: async () => [target],
    async reserveRun(item, request) {
      const { data, error } = await service.rpc("reserve_github_collection_run_server", {
        target_organisation_id: item.organisationId,
        target_installation_id: item.installationId,
        target_repository_id: item.repositoryId,
        target_provider_repository_id: item.providerRepositoryId,
        target_trigger_type: request.trigger,
        target_request_key: request.requestKey,
        target_lease_seconds: 180,
      });
      if (error) throw error;
      const reservation = toReservation(data, item);
      runId = reservation.runId;
      return reservation;
    },
    async listPersistedObservations(reservation, item) {
      const { data, error } = await service
        .from("github_observations")
        .select("observation_key,result")
        .eq("collection_run_id", reservation.runId)
        .eq("organisation_id", item.organisationId)
        .eq("installation_id", item.installationId)
        .eq("repository_id", item.repositoryId)
        .eq("provider_repository_id", item.providerRepositoryId)
        .order("observation_key", { ascending: true })
        .limit(EXPECTED_GITHUB_CHECK_IDS.length + 1);
      if (error || !Array.isArray(data)) throw error ?? new Error("Persisted observations were not returned");
      return data.map((row) => ({
        observationKey: String(row.observation_key),
        result: String(row.result) as GitHubObservation["result"],
      }));
    },
    async collectFacts() {
      factCollections += 1;
      return sanitisedFacts(input.repository, {
        partial: input.status === "partial",
        failOne: input.failOne === true,
      });
    },
    evaluate: evaluateGitHubRepository,
    async refreshRepository(reservation, item, facts) {
      const { data, error } = await service.rpc("refresh_github_repository_server", {
        target_run_id: reservation.runId,
        target_organisation_id: item.organisationId,
        target_installation_id: item.installationId,
        target_repository_id: item.repositoryId,
        target_provider_repository_id: item.providerRepositoryId,
        target_lease_token: reservation.leaseToken,
        target_attempt: reservation.attempt,
        target_owner_login: facts.repository.owner,
        target_name: facts.repository.name,
        target_html_url: facts.repository.url,
        target_visibility: facts.repository.visibility,
        target_default_branch: facts.repository.defaultBranch,
        target_archived: facts.repository.archived,
      });
      if (error || data !== true) throw error ?? new Error("Repository refresh was rejected");
    },
    async saveObservations(reservation, item, observations) {
      const payload = observations.map((row) => ({
        observation_key: row.observationKey,
        check_id: row.checkId,
        rule_version: row.ruleVersion,
        subject_type: row.subjectType,
        subject_id: row.subjectId,
        result: row.result,
        severity: row.severity,
        title: row.title,
        explanation: row.explanation,
        remediation: row.remediation,
        observed_at: row.observedAt,
        fresh_until: row.freshUntil,
        source_url: row.sourceUrl,
        fingerprint: row.fingerprint,
        diagnostic_code: row.diagnosticCode,
      }));
      const { data, error } = await service.rpc("save_github_observations_server", {
        target_run_id: reservation.runId,
        target_organisation_id: item.organisationId,
        target_installation_id: item.installationId,
        target_repository_id: item.repositoryId,
        target_provider_repository_id: item.providerRepositoryId,
        target_lease_token: reservation.leaseToken,
        target_attempt: reservation.attempt,
        target_observations: payload,
      });
      if (error || typeof data !== "number") throw error ?? new Error("Observations were not stored");
      return data;
    },
    async finaliseRun(reservation, item, result: RunResult) {
      const { data, error } = await service.rpc("finalise_github_collection_run_server", {
        target_run_id: reservation.runId,
        target_organisation_id: item.organisationId,
        target_installation_id: item.installationId,
        target_repository_id: item.repositoryId,
        target_provider_repository_id: item.providerRepositoryId,
        target_lease_token: reservation.leaseToken,
        target_attempt: reservation.attempt,
        target_status: result.status,
        target_diagnostic_code: result.diagnosticCode ?? null,
      });
      if (error || typeof data !== "boolean") throw error ?? new Error("Collection run was not finalised");
      return data;
    },
    now: () => new Date(),
  };

  const summary = await runGitHubCollection(dependencies, {
    trigger: "manual",
    runMode: "official",
    requestKey: input.requestKey,
    installationId: input.installationId,
    repositoryId: input.repository.id,
  });
  expect(factCollections).toBe(1);
  if (!runId) throw new Error("The local collection run ID was not captured");
  return { runId, summary };
}

function ageCompletedRunLocally(runId: string) {
  if (!/^[0-9a-f-]{36}$/.test(runId)) {
    throw new Error("The stale-run fixture is restricted to the local Supabase project");
  }
  const updated = execFileSync("docker", [
    "exec",
    "supabase_db_compliancehub",
    "psql",
    "--username",
    "postgres",
    "--dbname",
    "postgres",
    "--tuples-only",
    "--no-align",
    "--command",
    `with updated as (update public.github_collection_runs set started_at = now() - interval '40 hours', completed_at = now() - interval '40 hours' where id = '${runId}'::uuid returning 1) select count(*) from updated;`,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  expect(updated.trim()).toBe("1");
}

function selectRepositoriesLocally(organisationId: string, installationId: string, expectedCount: number) {
  if (!/^[0-9a-f-]{36}$/.test(organisationId) || !/^[0-9a-f-]{36}$/.test(installationId)) {
    throw new Error("The pagination fixture is restricted to the local Supabase project");
  }
  const updated = execFileSync("docker", [
    "exec",
    "supabase_db_compliancehub",
    "psql",
    "--username",
    "postgres",
    "--dbname",
    "postgres",
    "--tuples-only",
    "--no-align",
    "--command",
    `with updated as (update public.github_repositories set selected = true where organisation_id = '${organisationId}'::uuid and installation_id = '${installationId}'::uuid returning 1) select count(*) from updated;`,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  expect(updated.trim()).toBe(String(expectedCount));
}

function repositoryCard(page: Page, fullName: string): Locator {
  return page.getByRole("article", { name: `${fullName} monitoring status` });
}

test("selects repository scope in Connections and shows official collection health in Monitoring", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  assertLocalTestEnvironment();
  const owner = await createOwnerWorkspace(page, testInfo);
  const readinessBefore = await page.locator(".g-pct").innerText();
  const service = serviceClient();
  const provider = providerBase(testInfo);
  const accountLogin = `shadow-${owner.compact}`;
  const repositoryNames = ["fresh", "partial", "stale", "never"].map((state) => `${accountLogin}/${state}`);
  const paginationRepositoryNames = Array.from(
    { length: 37 },
    (_, index) => `${accountLogin}/pagination-${String(index + 1).padStart(2, "0")}`,
  );
  const allRepositoryNames = [...repositoryNames, ...paginationRepositoryNames];
  const providerIds = [provider, provider + 1, ...allRepositoryNames.map((_, index) => provider + 10 + index)];
  expect(providerIds.every((id) => Number.isSafeInteger(id) && id > 0)).toBe(true);
  expect(new Set(providerIds).size).toBe(providerIds.length);

  const { data: installationId, error: claimError } = await service.rpc("claim_github_installation_server", {
    target_organisation_id: owner.organisationId,
    target_actor_id: owner.userId,
    target_provider_installation_id: provider,
    target_account_id: provider + 1,
    target_account_login: accountLogin,
    target_account_type: "Organization",
    target_repository_selection: "selected",
    target_permissions: REQUIRED_PERMISSIONS,
    target_permissions_ok: true,
    target_repositories: allRepositoryNames.map((fullName, index) => {
      const name = fullName.split("/")[1];
      return {
        id: provider + 10 + index,
        owner: accountLogin,
        name,
        fullName,
        htmlUrl: `https://github.com/${fullName}`,
        visibility: "private",
        archived: false,
        defaultBranch: "main",
      };
    }),
  });
  expect(claimError).toBeNull();
  expect(installationId).toMatch(/^[0-9a-f-]{36}$/);

  await page.goto("/app/integrations");
  await expect(page.getByRole("heading", { name: "GitHub repository access" })).toBeVisible();
  for (const fullName of repositoryNames) await selectRepository(page, fullName);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  selectRepositoriesLocally(owner.organisationId, String(installationId), allRepositoryNames.length);

  const { data: repositories, error: repositoriesError } = await service
    .from("github_repositories")
    .select("id,provider_repository_id,owner_login,name,full_name,html_url,selected")
    .eq("organisation_id", owner.organisationId)
    .eq("installation_id", installationId)
    .order("name", { ascending: true });
  expect(repositoriesError).toBeNull();
  expect(repositories).toHaveLength(41);
  expect(repositories?.every((repository) => repository.selected === true)).toBe(true);
  const byName = new Map((repositories ?? []).map((repository) => [repository.name, repository as RepositorySeed]));

  const freshCollection = await completeCollection(service, {
    organisationId: owner.organisationId,
    installationId: String(installationId),
    providerInstallationId: provider,
    repository: byName.get("fresh")!,
    requestKey: `e2e:${owner.compact}:fresh`,
    status: "succeeded",
    failOne: true,
  });
  expect(freshCollection.summary).toEqual({
    installationsChecked: 1,
    repositoriesChecked: 1,
    observationsStored: EXPECTED_GITHUB_CHECK_IDS.length,
    repositoriesFailed: 0,
    repositoriesDeferred: 0,
    runsPartial: 0,
    terminalRuns: [{
      collectionRunId: freshCollection.runId,
      organisationId: owner.organisationId,
      installationId: String(installationId),
      repositoryId: byName.get("fresh")!.id,
      providerRepositoryId: byName.get("fresh")!.provider_repository_id,
      status: "succeeded",
    }],
  });
  const partialCollection = await completeCollection(service, {
    organisationId: owner.organisationId,
    installationId: String(installationId),
    providerInstallationId: provider,
    repository: byName.get("partial")!,
    requestKey: `e2e:${owner.compact}:partial`,
    status: "partial",
  });
  expect(partialCollection.summary).toEqual({
    installationsChecked: 1,
    repositoriesChecked: 1,
    observationsStored: EXPECTED_GITHUB_CHECK_IDS.length,
    repositoriesFailed: 0,
    repositoriesDeferred: 0,
    runsPartial: 1,
    terminalRuns: [{
      collectionRunId: partialCollection.runId,
      organisationId: owner.organisationId,
      installationId: String(installationId),
      repositoryId: byName.get("partial")!.id,
      providerRepositoryId: byName.get("partial")!.provider_repository_id,
      status: "partial",
    }],
  });
  const staleCollection = await completeCollection(service, {
    organisationId: owner.organisationId,
    installationId: String(installationId),
    providerInstallationId: provider,
    repository: byName.get("stale")!,
    requestKey: `e2e:${owner.compact}:stale`,
    status: "succeeded",
  });
  expect(staleCollection.summary).toEqual({
    installationsChecked: 1,
    repositoriesChecked: 1,
    observationsStored: EXPECTED_GITHUB_CHECK_IDS.length,
    repositoriesFailed: 0,
    repositoriesDeferred: 0,
    runsPartial: 0,
    terminalRuns: [{
      collectionRunId: staleCollection.runId,
      organisationId: owner.organisationId,
      installationId: String(installationId),
      repositoryId: byName.get("stale")!.id,
      providerRepositoryId: byName.get("stale")!.provider_repository_id,
      status: "succeeded",
    }],
  });
  ageCompletedRunLocally(staleCollection.runId);

  await page.goto("/app/monitoring");
  await expect(page.getByRole("heading", { name: "GitHub monitoring" })).toBeVisible();
  await expect(repositoryCard(page, `${accountLogin}/fresh`).getByText("Up to date", { exact: true })).toBeVisible();
  await expect(repositoryCard(page, `${accountLogin}/fresh`)).toContainText("1 check needs attention");
  await expect(repositoryCard(page, `${accountLogin}/fresh`)).toContainText("Last checked");
  await expect(repositoryCard(page, `${accountLogin}/partial`).getByText("Some checks could not be completed", { exact: true })).toBeVisible();
  await expect(repositoryCard(page, `${accountLogin}/stale`).getByText("Needs a new check", { exact: true })).toBeVisible();
  await expect(repositoryCard(page, `${accountLogin}/never`).getByText("Ready for first check", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check GitHub now" })).toBeVisible();
  const technicalReview = page.locator("details.monitor-technical-review");
  await expect(technicalReview).not.toHaveAttribute("open", "");
  await expect(page.getByRole("heading", { name: "From repository facts to reviewed records" })).not.toBeVisible();
  await technicalReview.locator(":scope > summary").click();
  await expect(page.getByRole("heading", { name: "From repository facts to reviewed records" })).toBeVisible();
  await expect(page.getByText("Review all 15 mapped checks").locator("xpath=.." )).not.toHaveAttribute("open", "");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  const { error: legacyFindingError } = await service.from("monitoring_findings").insert({
    organisation_id: owner.organisationId,
    check_id: "e2e.monitoring.touch-target",
    control_ref: "A.8.32",
    subject_type: "repository",
    subject_id: `touch-target/${owner.compact}`,
    severity: "medium",
    title: "Review the local phone action",
    detail: "Synthetic local finding used only to verify Monitoring touch targets.",
    status: "open",
    finding_origin: "legacy",
    mapping_version: "legacy",
  });
  if (legacyFindingError) throw legacyFindingError;
  await page.reload();
  await page.locator("details.monitor-technical-review > summary").click();

  for (const width of [1440, 1024, 801, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.locator("html").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    for (const component of [
      page.getByRole("region", { name: "GitHub monitoring" }),
      page.locator(".github-control-room"),
    ]) {
      const box = await component.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect(await component.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
    if (width === 390) {
      await page.goto("/app/monitoring?githubPage=2");
      await page.locator("details.monitor-technical-review > summary").click();
      await page.waitForTimeout(250);
      const pagination = page.getByRole("navigation", { name: "Repository result pages" });
      await expect(pagination).toContainText("Page 2");
      const paginationColumns = await pagination.evaluate(
        (element) => getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean),
      );
      expect(paginationColumns).toHaveLength(1);
      for (const linkName of ["Previous repositories", "Next repositories"]) {
        const link = pagination.getByRole("link", { name: linkName });
        await expect(link).toBeVisible();
        const linkMetrics = await link.evaluate((element) => ({
          width: element.getBoundingClientRect().width,
          parentWidth: element.parentElement!.getBoundingClientRect().width,
          minHeight: Number.parseFloat(getComputedStyle(element).minHeight),
        }));
        expect(linkMetrics.width, `${linkName} width`).toBeCloseTo(linkMetrics.parentWidth, 0);
        expect(linkMetrics.minHeight, `${linkName} minimum height`).toBeGreaterThanOrEqual(44);
        await link.focus();
        await expect(link).toBeFocused();
      }
      const columns = await page.locator(".github-control-room-steps").evaluate(
        (element) => getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean),
      );
      expect(columns).toHaveLength(1);
      const actionMetrics = await page.getByRole("button", { name: "Check GitHub now" }).evaluate((element) => {
        const button = element as HTMLElement;
        const parent = button.parentElement!;
        const parentStyle = getComputedStyle(parent);
        const availableWidth = parent.clientWidth
          - Number.parseFloat(parentStyle.paddingLeft)
          - Number.parseFloat(parentStyle.paddingRight);
        return {
          width: button.getBoundingClientRect().width,
          availableWidth,
          minHeight: Number.parseFloat(getComputedStyle(button).minHeight),
        };
      });
      expect(actionMetrics.width).toBeCloseTo(actionMetrics.availableWidth, 0);
      expect(actionMetrics.minHeight).toBeGreaterThanOrEqual(44);

      await page.locator(".monitoring-page").evaluate((monitoringPage) => {
        const fixture = document.createElement("article");
        fixture.className = "github-official-record github-touch-target-fixture";
        fixture.setAttribute("aria-label", "GitHub finding touch target fixture");
        fixture.innerHTML = '<div class="github-finding-review"><div class="github-finding-review-controls"><button class="button secondary" type="button">GitHub finding fixture action</button></div></div>';
        monitoringPage.append(fixture);
      });

      const touchActions = [
        { label: "summary", action: page.getByRole("link", { name: "Manage connections and alerts" }) },
        { label: "legacy finding", action: page.getByRole("button", { name: "Acknowledge" }).first() },
        { label: "health panel", action: page.getByRole("button", { name: "Check GitHub now" }) },
        { label: "GitHub finding", action: page.getByRole("button", { name: "GitHub finding fixture action" }) },
        { label: "technical review", action: technicalReview.getByRole("button").first() },
      ];
      for (const { label, action } of touchActions) {
        await expect(action).toBeVisible();
        const metrics = await action.evaluate((element) => {
          const target = element as HTMLElement;
          const parent = target.parentElement!;
          const parentStyle = getComputedStyle(parent);
          const parentAvailableWidth = parent.clientWidth
            - Number.parseFloat(parentStyle.paddingLeft)
            - Number.parseFloat(parentStyle.paddingRight);
          const form = target.closest("form");
          const formParent = form?.parentElement;
          const formParentStyle = formParent ? getComputedStyle(formParent) : null;
          return {
            width: target.getBoundingClientRect().width,
            minHeight: Number.parseFloat(getComputedStyle(target).minHeight),
            parentAvailableWidth,
            formWidth: form?.getBoundingClientRect().width ?? null,
            formParentAvailableWidth: formParent && formParentStyle
              ? formParent.clientWidth
                - Number.parseFloat(formParentStyle.paddingLeft)
                - Number.parseFloat(formParentStyle.paddingRight)
              : null,
          };
        });
        expect(metrics.width, `${label} action width`).toBeCloseTo(metrics.parentAvailableWidth, 0);
        expect(metrics.minHeight, `${label} action minimum height`).toBeGreaterThanOrEqual(44);
        if (metrics.formWidth !== null && metrics.formParentAvailableWidth !== null) {
          expect(metrics.formWidth).toBeCloseTo(metrics.formParentAvailableWidth, 0);
        }
      }
    }
  }

  await page.goto("/app");
  await expect(page.locator(".g-pct")).toHaveText(readinessBefore);
});
