import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createTeamFixture, signIn, teamTestEnabled } from "./helpers/team-workspace";

test.skip(!teamTestEnabled || process.env.COMPLIANCEHUB_UI_DEMO !== "1", "Isolated fictional local dashboard demonstration only.");

test("programme overview shows real counts, source links and readable charts across screen sizes", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const fixture = await createTeamFixture();
  const { coordinator, organisationId, actors } = fixture;
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
  const past = new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10);
  const { data: category } = await coordinator.from("risk_categories").select("id").eq("organisation_id", organisationId).order("position").limit(1).single();
  expect(category).not.toBeNull();
  const { data: catalogue } = await coordinator.from("catalogue_versions").select("id").limit(1).single();
  expect(catalogue).not.toBeNull();
  const { data: session, error: sessionError } = await coordinator.from("assessment_sessions").insert({
    organisation_id: organisationId, catalogue_version_id: catalogue!.id,
    title: "Fictional dashboard assessment", created_by: actors[0].id,
  }).select("id").single();
  expect(sessionError).toBeNull();
  const { data: registerId, error: registerError } = await coordinator.rpc("create_or_reuse_soa_review", {
    target_assessment_session_id: session!.id,
  });
  expect(registerError).toBeNull();
  expect(registerId).toBeTruthy();
  const { data: controls, error: controlsError } = await coordinator.from("soa_items")
    .select("id,decision_revision,applicable,status,justification,evidence,owner_id")
    .eq("soa_register_id", registerId).order("position");
  expect(controlsError).toBeNull();
  const bands = [
    { start: 0, end: 21, status: "advanced" },
    { start: 21, end: 46, status: "operational" },
    { start: 46, end: 66, status: "established" },
    { start: 66, end: 79, status: "in_progress" },
  ];
  for (const band of bands) {
    const changes = (controls ?? []).slice(band.start, band.end).map((item) => ({
      itemId: item.id,
      expectedRevision: item.decision_revision,
      applicable: item.applicable,
      status: band.status,
      justification: "Fictional visual demonstration only.",
      evidence: item.evidence ?? "",
      ownerId: item.owner_id,
    }));
    if (!changes.length) continue;
    const result = await coordinator.rpc("update_soa_decisions_guarded", {
      target_register_id: registerId,
      changes,
    });
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(changes.length);
  }
  const results = await Promise.all([
    coordinator.from("tasks").update({ due_on: future }).eq("organisation_id", organisationId),
    coordinator.from("tasks").insert({ organisation_id: organisationId, title: "Review production access", detail: "Fictional overdue task", due_on: past, status: "open", created_by: actors[0].id }),
    coordinator.from("tasks").insert({ organisation_id: organisationId, title: "Completed historical work", due_on: past, status: "done", created_by: actors[0].id }),
    coordinator.from("policies").insert({ organisation_id: organisationId, reference: "DEMO-REVIEW", title: "Information security policy", body: "Fictional policy for visual review.", status: "in_review", created_by: actors[0].id }),
    coordinator.from("risks").insert(Array.from({ length: 6 }, (_, index) => ({
      organisation_id: organisationId, reference: `DEMO-${index}`, category_id: category!.id,
      title: `Fictional risk ${index + 1}`, description: "Fictional risk for the programme dashboard.",
      likelihood: index % 5 + 1, impact: (index + 2) % 5 + 1, residual_likelihood: index % 5 + 1, residual_impact: (index + 2) % 5 + 1,
      treatment: "mitigate", status: index === 5 ? "closed" : "open", created_by: actors[0].id,
    }))),
    coordinator.from("evidence").insert([
      { title: "Access review notes", status: "current", valid_until: null },
      { title: "Backup restore report", status: "expiring", valid_until: future },
      { title: "Earlier review notes", status: "expired", valid_until: past },
    ].map((item) => ({ ...item, organisation_id: organisationId, kind: "note", description: "Fictional evidence for visual review.", collected_on: today, created_by: actors[0].id }))),
  ]);
  for (const result of results) expect(result.error).toBeNull();
  await signIn(page, actors[0]);
  await page.getByText("Why this needs attention", { exact: true }).first().click();
  await expect(page.getByText(/still needs an applicability decision before/).first()).toBeVisible();
  await page.getByText("Why this needs attention", { exact: true }).first().click();
  for (const width of [1440, 883, 393]) {
    await page.setViewportSize({ width, height: width === 393 ? 851 : 1000 });
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: "Programme overview", exact: true })).toBeVisible();
    const attention = page.getByRole("navigation", { name: "Programme attention" });
    await expect(attention.getByRole("link", { name: /Open risks/ })).toContainText("5");
    await expect(attention.getByRole("link", { name: /Overdue tasks/ })).toContainText("1");
    await expect(attention.getByRole("link", { name: /Policies in review/ })).toContainText("1");
    await expect(attention.getByRole("link", { name: /Evidence expiring/ })).toContainText("1");
    await expect(page.getByText("Current position · latest Statement of Applicability")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Coming up", exact: true })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
    const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(scan.violations.filter((item) => item.impact === "serious" || item.impact === "critical")).toEqual([]);
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`dashboard-${width}.png`), fullPage: true });
  }
  await page.getByText("How this score works", { exact: true }).click();
  await expect(page.getByText(/Pending decisions count as zero/)).toBeVisible();
  await page.getByRole("navigation", { name: "Programme attention" }).getByRole("link", { name: /Overdue tasks/ }).click();
  await expect(page).toHaveURL(/\/app\/tasks\?filter=overdue$/);
  await expect(page.getByRole("link", { name: "Review production access", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Completed historical work", exact: true })).toHaveCount(0);
});

test("empty programme shows measured zeros, absent controls and the existing member experience", async ({ page }, testInfo) => {
  const { actors, coordinator, organisationId } = await createTeamFixture();
  const result = await coordinator.from("tasks").update({ due_on: null }).eq("organisation_id", organisationId);
  expect(result.error).toBeNull();
  await signIn(page, actors[0]);
  await page.setViewportSize({ width: 393, height: 851 });
  await page.goto("/app");
  const attention = page.getByRole("navigation", { name: "Programme attention" });
  for (const label of ["Open risks", "Overdue tasks", "Policies in review", "Evidence expiring"]) {
    await expect(attention.getByRole("link", { name: new RegExp(label) })).toContainText("0");
  }
  await expect(page.getByText("No controls to score", { exact: true })).toBeVisible();
  await expect(page.getByText("No upcoming dates in this shortlist. Open all tasks to see the full schedule.")).toBeVisible();
  await page.screenshot({ animations: "disabled", path: testInfo.outputPath("dashboard-empty-mobile.png"), fullPage: true });
  await page.context().clearCookies();
  await signIn(page, actors[1]);
  await page.goto("/app");
  await expect(page.getByRole("navigation", { name: "Programme attention" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Programme overview", exact: true })).toHaveCount(0);
  await expect(page.getByRole("main")).toContainText("MEMBER OVERVIEW");
  await expect(page.getByRole("main")).toContainText("contribute to assigned tasks");
});
