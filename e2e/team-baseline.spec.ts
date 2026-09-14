import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { clientFor, createTeamFixture, signIn, teamTestEnabled } from "./helpers/team-workspace";

test.skip(!teamTestEnabled, "This fictional demonstration requires the separate local team-baseline database.");

async function preparedBaseline() {
  const fixture = await createTeamFixture();
  const { coordinator, actors, organisationId } = fixture;
  const { data: catalogue, error: catalogueError } = await coordinator.from("catalogue_versions").select("id").not("published_at", "is", null).order("published_at", { ascending: false }).limit(1).single();
  if (catalogueError) throw catalogueError;
  const { data: assessment, error: assessmentError } = await coordinator.from("assessment_sessions").insert({ organisation_id: organisationId, catalogue_version_id: catalogue!.id, title: "Fictional starting assessment", created_by: actors[0].id }).select("id").single();
  if (assessmentError) throw assessmentError;
  const { error: scopeError } = await coordinator.from("organisation_scope_profiles").insert({ organisation_id: organisationId, scope_statement: "Fictional software startup security baseline", services: "Customer-facing SaaS application", locations: "Remote team", information_types: "Fictional account and application records", dependencies: "Cloud hosting and source control", exclusions: "Physical manufacturing is outside this fictional scope", updated_by: actors[0].id });
  if (scopeError) throw scopeError;
  const { error: evidenceError } = await coordinator.from("evidence").insert({ organisation_id: organisationId, title: "Expired fictional review note", kind: "note", description: "Fictional old record; it must not be described as fresh evidence.", collected_on: "2026-08-01", valid_until: "2026-08-31", status: "current", created_by: actors[0].id });
  if (evidenceError) throw evidenceError;
  return { ...fixture, assessmentId: assessment!.id };
}

test("a coordinator resumes and saves a partial baseline while leadership reads preserved versions", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const { coordinator, actors, organisationId, tasks, assessmentId } = await preparedBaseline();
  const viewport = testInfo.project.name === "mobile" ? { width: 393, height: 851 } : { width: 1440, height: 1000 };
  const operatorContext = await browser.newContext({ baseURL, viewport });
  const readerContext = await browser.newContext({ baseURL, viewport });
  const operator = await operatorContext.newPage();
  const reader = await readerContext.newPage();
  operator.setDefaultTimeout(20_000);
  reader.setDefaultTimeout(20_000);
  const objective = "Prepare a clear, fictional leadership review without claiming certification.";
  try {
    await signIn(operator, actors[0]);
    await operator.goto("/app/baseline");
    await operator.getByRole("textbox", { name: "Objective", exact: true }).fill(objective);
    await operator.getByRole("combobox", { name: "Assessment", exact: true }).selectOption(assessmentId);
    await operator.getByRole("button", { name: "Save progress", exact: true }).click();
    await expect(operator.getByRole("status")).toBeVisible();
    await operator.reload();
    await expect(operator.getByRole("textbox", { name: "Objective", exact: true })).toHaveValue(objective);
    await expect(operator.getByRole("combobox", { name: "Assessment", exact: true })).toHaveValue(assessmentId);
    await operator.getByRole("button", { name: "Save dated baseline", exact: true }).click();
    await expect(operator).toHaveURL(/\/app\/baseline\?snapshot=[0-9a-f-]+/);
    const firstUrl = operator.url();
    const firstId = new URL(firstUrl).searchParams.get("snapshot")!;
    const { data: firstSnapshot, error: firstError } = await coordinator.from("baseline_snapshots").select("payload,progress_revision").eq("id", firstId).single();
    expect(firstError).toBeNull();
    expect(firstSnapshot!.payload.objective).toBe(objective);
    await expect(operator.getByText(/assessment questions were unanswered/)).toBeVisible();
    await expect(operator.getByText(/evidence records had expired at the saved date/)).toBeVisible();

    const owner = await clientFor(actors[1]);
    const { data: submitted, error: submitError } = await owner.rpc("submit_task_contribution", { target_organisation_id: organisationId, target_task_id: tasks[0].id, expected_assignment_revision: tasks[0].assignment_revision, submission_note: "Fictional review completed; no live-provider verification is claimed.", submission_request_id: randomUUID() });
    expect(submitError).toBeNull();
    const { error: acceptError } = await coordinator.rpc("review_task_contribution", { target_organisation_id: organisationId, target_contribution_id: submitted, review_decision: "accepted", review_rationale: "Accepted as the fictional written record only.", review_request_id: randomUUID() });
    expect(acceptError).toBeNull();
    const { error: doneError } = await coordinator.from("tasks").update({ status: "done" }).eq("id", tasks[0].id);
    expect(doneError).toBeNull();
    await operator.goto("/app/baseline");
    await operator.getByRole("button", { name: "Save dated baseline", exact: true }).click();
    await expect(operator).toHaveURL(/\/app\/baseline\?snapshot=[0-9a-f-]+/);
    const secondUrl = operator.url();
    expect(secondUrl).not.toBe(firstUrl);
    await expect(operator.getByText("Open tasks: 2 → 1", { exact: true })).toBeVisible();
    await expect(operator.getByText(/do not establish verified improvement/)).toBeVisible();
    await operator.screenshot({ path: testInfo.outputPath("baseline-comparable-changes.png"), fullPage: true });

    await signIn(reader, actors[3]);
    await reader.goto(firstUrl);
    await expect(reader.getByRole("button", { name: "Save dated baseline", exact: true })).toHaveCount(0);
    await expect(reader.getByRole("textbox", { name: "Objective", exact: true })).toHaveCount(0);
    await expect(reader.getByText(objective, { exact: true })).toBeVisible();
    await expect(reader.getByText(/Viewing this baseline does not record leadership approval/)).toBeVisible();
    await reader.screenshot({ path: testInfo.outputPath("leadership-preserved-baseline.png"), fullPage: true });
    expect(await reader.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    const { data: preserved } = await coordinator.from("baseline_snapshots").select("payload").eq("id", firstId).single();
    expect(preserved!.payload).toEqual(firstSnapshot!.payload);

    const { error: scopeChangeError } = await coordinator.from("organisation_scope_profiles").update({ services: "Expanded fictional scope including an internal admin service", updated_by: actors[0].id }).eq("organisation_id", organisationId);
    expect(scopeChangeError).toBeNull();
    await operator.goto("/app/baseline");
    await operator.getByRole("button", { name: "Save dated baseline", exact: true }).click();
    await expect(operator.getByText("The recorded scope changed; these baselines cannot be compared.", { exact: true })).toBeVisible();
    await reader.goto(firstUrl);
    await expect(reader.getByText("Customer-facing SaaS application", { exact: true })).toBeVisible();
    await expect(reader.getByText("Expanded fictional scope including an internal admin service", { exact: true })).toHaveCount(0);
  } finally {
    await Promise.allSettled([operatorContext.close(), readerContext.close()]);
  }
});

test("concurrent baseline saves retry safely and reject stale competing edits", async () => {
  const { coordinator, organisationId } = await createTeamFixture();
  const input = { target_organisation_id: organisationId, expected_revision: 0, baseline_objective: "Fictional concurrent starting baseline", selected_assessment_id: null, save_request_id: randomUUID(), create_snapshot: true };
  const identical = await Promise.all([coordinator.rpc("save_baseline_progress", input), coordinator.rpc("save_baseline_progress", input)]);
  expect(identical.map((item) => item.error)).toEqual([null, null]);
  expect(identical[0].data).toEqual(identical[1].data);
  const different = await Promise.all([coordinator.rpc("save_baseline_progress", { ...input, expected_revision: 1, save_request_id: randomUUID() }), coordinator.rpc("save_baseline_progress", { ...input, expected_revision: 1, save_request_id: randomUUID() })]);
  expect(different.filter((item) => item.error === null)).toHaveLength(1);
  expect(different.filter((item) => item.error?.code === "PT409")).toHaveLength(1);
  const retryOriginal = await coordinator.rpc("save_baseline_progress", input);
  expect(retryOriginal.error).toBeNull();
  expect(retryOriginal.data).toEqual(identical[0].data);
  const { data: snapshots } = await coordinator.from("baseline_snapshots").select("id").eq("organisation_id", organisationId);
  expect(snapshots).toHaveLength(2);
});
