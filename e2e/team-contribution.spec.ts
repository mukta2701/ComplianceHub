import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const isolatedApi = "http://127.0.0.1:55321";
const configuredApi = process.env.NEXT_PUBLIC_SUPABASE_URL;
test.skip(configuredApi !== isolatedApi, "This fictional demonstration requires the separate local team-baseline database.");

type Actor = { id: string; email: string; password: string };
async function signIn(page: Page, actor: Actor) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(actor.email);
  await page.getByLabel("Password", { exact: true }).fill(actor.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/app(?:\/.*)?$/);
}
async function clientFor(actor: Actor): Promise<SupabaseClient> {
  const client = createClient(isolatedApi, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: actor.email, password: actor.password });
  if (error) throw new Error("Fictional actor sign-in failed");
  return client;
}
async function fixture() {
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

test("assigned owners submit, coordinator reviews, and leadership reads the separate outcomes", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const { actors, organisationId, coordinator, tasks } = await fixture();
  const contexts = await Promise.all(actors.map(() => browser.newContext({ viewport: testInfo.project.name === "mobile" ? { width: 393, height: 851 } : { width: 1440, height: 1000 } })));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  try {
    for (let i = 0; i < actors.length; i++) await signIn(pages[i], actors[i]);
    const [reviewer, firstOwner, secondOwner, reader] = pages;
    await firstOwner.goto(`/app/tasks/${tasks[0].id}`);
    await expect(firstOwner.getByLabel("Work note", { exact: true })).toBeVisible();
    await firstOwner.getByLabel("Work note", { exact: true }).fill("Fictional initial access review: accounts examined; the removal decision is still missing.");
    await firstOwner.getByRole("button", { name: "Submit for review", exact: true }).click();
    await expect(firstOwner.getByText("Awaiting review", { exact: true }).first()).toBeVisible();
    await expect(firstOwner.getByRole("button", { name: "Accept evidence", exact: true })).toHaveCount(0);

    await reader.goto(`/app/tasks/${tasks[0].id}`);
    await expect(reader.getByLabel("Work note", { exact: true })).toHaveCount(0);
    const readerClient = await clientFor(actors[3]);
    const denied = await readerClient.rpc("submit_task_contribution", { target_organisation_id: organisationId, target_task_id: tasks[0].id, expected_assignment_revision: tasks[0].assignment_revision, submission_note: "Attempt by unrelated reader", submission_request_id: randomUUID() });
    expect(denied.error).not.toBeNull();

    await reviewer.goto("/app/tasks");
    await expect(reviewer.getByText("Awaiting review", { exact: true }).first()).toBeVisible();
    await reviewer.goto(`/app/tasks/${tasks[0].id}`);
    await reviewer.getByLabel("Review note", { exact: true }).fill("Please include the decision about the unused account; this is fictional review feedback.");
    await reviewer.getByRole("button", { name: "Request changes", exact: true }).click();
    await expect(reviewer.getByText("Changes requested", { exact: true }).first()).toBeVisible();

    await firstOwner.reload();
    await firstOwner.getByLabel("Work note", { exact: true }).fill("Fictional revised access review: unused account recorded for removal. This note does not prove a live provider change.");
    await firstOwner.getByRole("button", { name: "Submit for review", exact: true }).click();
    await expect(firstOwner.getByText("Awaiting review", { exact: true }).first()).toBeVisible();
    await reviewer.reload();
    await reviewer.getByLabel("Review note", { exact: true }).fill("Accepted as the fictional record of this review. Technical removal remains unverified.");
    await reviewer.getByRole("button", { name: "Accept evidence", exact: true }).click();
    await expect(reviewer.getByText("Accepted", { exact: true }).first()).toBeVisible();

    await secondOwner.goto(`/app/tasks/${tasks[1].id}`);
    await secondOwner.getByLabel("Work note", { exact: true }).fill("Fictional backup exercise: restoration procedure reviewed; no real recovery test was performed.");
    await secondOwner.getByRole("button", { name: "Submit for review", exact: true }).click();
    await expect(secondOwner.getByText("Awaiting review", { exact: true }).first()).toBeVisible();
    await secondOwner.screenshot({ path: testInfo.outputPath("owner-awaiting-review.png"), fullPage: true });

    await reader.reload();
    await expect(reader.getByRole("heading", { name: "Submission history", exact: true })).toBeVisible();
    await expect(reader.getByText("Accepted", { exact: true }).first()).toBeVisible();
    await expect(reader.getByText("Changes requested", { exact: true }).first()).toBeVisible();
    await reader.screenshot({ path: testInfo.outputPath("leadership-submission-history.png"), fullPage: true });
    const overflow = await reader.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);

    const { data: submissions, error: readError } = await coordinator.from("task_contributions").select("id,decision,evidence_id,submitter_id,reviewer_id").eq("organisation_id", organisationId).eq("task_id", tasks[0].id);
    expect(readError).toBeNull();
    expect(submissions).toHaveLength(2);
    const accepted = submissions!.find((item) => item.decision === "accepted")!;
    expect(accepted.submitter_id).toBe(actors[1].id);
    expect(accepted.reviewer_id).toBe(actors[0].id);
    expect(accepted.evidence_id).toBeTruthy();
    const { data: links } = await coordinator.from("evidence_links").select("id").eq("organisation_id", organisationId).eq("task_id", tasks[0].id).eq("evidence_id", accepted.evidence_id);
    expect(links).toHaveLength(1);
    const { data: unchangedTask } = await coordinator.from("tasks").select("status").eq("id", tasks[0].id).single();
    expect(unchangedTask?.status).toBe("in_progress");
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("real concurrent submissions preserve one handoff and reassignment revokes old authority", async () => {
  const { actors, organisationId, coordinator, tasks } = await fixture();
  const firstOwner = await clientFor(actors[1]);
  const secondOwner = await clientFor(actors[2]);
  const retryInput = { target_organisation_id: organisationId, target_task_id: tasks[0].id, expected_assignment_revision: tasks[0].assignment_revision, submission_note: "Fictional concurrent retry of the same work note.", submission_request_id: randomUUID() };
  const identical = await Promise.all([firstOwner.rpc("submit_task_contribution", retryInput), firstOwner.rpc("submit_task_contribution", retryInput)]);
  expect(identical.map((result) => result.error)).toEqual([null, null]);
  expect(identical[0].data).toBe(identical[1].data);
  const mismatch = await firstOwner.rpc("submit_task_contribution", { ...retryInput, submission_note: "Different payload using the same request key" });
  expect(mismatch.error).not.toBeNull();

  const distinctInput = { target_organisation_id: organisationId, target_task_id: tasks[1].id, expected_assignment_revision: tasks[1].assignment_revision, submission_note: "Fictional concurrent independent clicks." };
  const distinct = await Promise.all([secondOwner.rpc("submit_task_contribution", { ...distinctInput, submission_request_id: randomUUID() }), secondOwner.rpc("submit_task_contribution", { ...distinctInput, submission_request_id: randomUUID() })]);
  expect(distinct.filter((result) => result.error === null)).toHaveLength(1);
  expect(distinct.filter((result) => result.error !== null)).toHaveLength(1);
  const { data: pending } = await coordinator.from("task_contributions").select("id").eq("task_id", tasks[1].id).eq("decision", "pending");
  expect(pending).toHaveLength(1);

  const { error: assignmentError } = await coordinator.from("tasks").update({ owner_id: actors[2].id }).eq("id", tasks[0].id);
  expect(assignmentError).toBeNull();
  const revokedRetry = await firstOwner.rpc("submit_task_contribution", retryInput);
  expect(revokedRetry.error).not.toBeNull();
  const staleReview = await coordinator.rpc("review_task_contribution", { target_organisation_id: organisationId, target_contribution_id: identical[0].data, review_decision: "accepted", review_rationale: "This stale assignment must be rejected.", review_request_id: randomUUID() });
  expect(staleReview.error).not.toBeNull();
  const { data: reassigned } = await coordinator.from("tasks").select("assignment_revision,status").eq("id", tasks[0].id).single();
  expect(reassigned!.assignment_revision).toBeGreaterThan(tasks[0].assignment_revision);
  const newOwner = await secondOwner.rpc("submit_task_contribution", { ...retryInput, expected_assignment_revision: reassigned!.assignment_revision, submission_note: "Fictional response from the newly assigned owner.", submission_request_id: randomUUID() });
  expect(newOwner.error).toBeNull();
  expect(reassigned!.status).toBe("in_progress");
});
