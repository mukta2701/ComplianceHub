import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { clientFor, createTeamFixture as fixture, signIn, teamTestEnabled } from "./helpers/team-workspace";

test.skip(!teamTestEnabled, "This fictional demonstration requires the separate local team-baseline database.");

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
