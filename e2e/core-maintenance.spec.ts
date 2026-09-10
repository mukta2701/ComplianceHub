import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

function env(name: string) {
  if (process.env[name]) return process.env[name]!;
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) throw new Error(`${name} is required`);
  const line = readFileSync(file, "utf8").split("\n").find((x) => x.startsWith(`${name}=`));
  if (!line) throw new Error(`${name} is required`);
  return line.slice(name.length + 1);
}

function password(seed: string) { return `E2e-${createHash("sha256").update(seed).digest("hex").slice(0, 24)}-Aa1!`; }
function admin() { return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } }); }
async function confirm(email: string) {
  const client = admin();
  let user: { id: string } | undefined;
  for (let attempt = 0; attempt < 20 && !user; attempt += 1) {
    const { data, error } = await client.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;
    user = data.users.find((item) => item.email === email);
    if (!user) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!user) throw new Error("E2E user was not found");
  const result = await client.auth.admin.updateUserById(user.id, { email_confirm: true });
  if (result.error) throw result.error;
}
async function workspace(page: Page, info: TestInfo) {
  const suffix = `${Date.now()}-${info.project.name}`;
  const email = `maintenance-${suffix}@example.test`, pass = password(suffix), organisation = `Maintenance ${suffix}`;
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Maintenance Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(pass);
  await page.getByLabel("Confirm password").fill(pass);
  await Promise.all([page.waitForURL((url) => ["/sign-in", "/app", "/app/onboarding"].includes(url.pathname)), page.getByRole("button", { name: "Create account" }).click()]);
  await confirm(email);
  if (new URL(page.url()).pathname === "/sign-in") { await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(pass);
  await page.getByRole("button", { name: "Sign in" }).click(); }
  await expect(page.getByRole("heading", { name: "Create your organisation" })).toBeVisible();
  await page.getByLabel("Organisation name").fill(organisation);
  const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/app");
  const [response] = await Promise.all([responsePromise, page.getByRole("button", { name: "Create workspace" }).click()]);
  expect(response.status()).toBeLessThan(400);
  await expect(page.getByRole("heading", { name: "Programme overview" })).toBeVisible();
  const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password: pass });
  expect(signIn.error).toBeNull();
  const { data: org } = await admin().from("organisations").select("id").eq("name", organisation).single();
  if (!org) throw new Error("E2E workspace was not found");
  return { db, orgId: org.id, ownerEmail: email, ownerPassword: pass, ownerName: "Maintenance Owner" };
}
test("risk and task metadata edits persist without changing status or source", async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize(info.project.name === "mobile" ? { width: 393, height: 851 } : { width: 1440, height: 1000 });
  const { db, orgId, ownerName } = await workspace(page, info);
  await page.goto("/app/risks/new");
  await expect(page.getByRole("group", { name: "Risk context" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Exposure scoring" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Treatment and review" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/app/risks");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ animations: "disabled", path: info.outputPath("risk-new.png"), fullPage: true });
  await page.getByLabel("Reference", { exact: true }).fill("R-MAINT");
  await page.getByLabel("Title", { exact: true }).fill("Original risk");
  await page.getByLabel("Description", { exact: true }).fill("Original description");
  await page.getByLabel("Category").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Create risk" }).click();
  await expect(page).toHaveURL("/app/risks");
  const riskLookup = await db.from("risks").select("id").eq("organisation_id", orgId).eq("reference", "R-MAINT").single();
  expect(riskLookup.error).toBeNull(); if (!riskLookup.data) throw new Error("E2E risk fixture was not created");
  const riskId = riskLookup.data.id;
  await expect(page.locator("#main-content").getByRole("heading", { name: "Risk register", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Original risk", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const riskTable = page.getByRole("region", { name: "Risk register table" });
  if (info.project.name === "mobile") {
    await expect(riskTable).toBeHidden();
    await page.screenshot({ animations: "disabled", path: info.outputPath("risk-register-mobile.png"), fullPage: true });
  } else {
    await expect(riskTable).toBeVisible();
    await page.screenshot({ animations: "disabled", path: info.outputPath("risk-register-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 883, height: 1000 });
    await expect(riskTable).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ animations: "disabled", path: info.outputPath("risk-register-tablet.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await page.goto(`/app/risks/${riskId}`);
  await page.getByRole("link", { name: "Edit risk" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/risks/${riskId}/edit$`));
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Updated risk");
  await page.getByRole("textbox", { name: "Description", exact: true }).fill("Updated description");
  await page.getByRole("combobox", { name: "Likelihood", exact: true }).selectOption("5");
  await page.getByLabel("Owner").selectOption({ label: ownerName });
  await page.getByRole("button", { name: "Save risk" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/risks/${riskId}$`));
  await expect(page.getByRole("heading", { name: "Updated risk" })).toBeVisible();
  await expect(page.getByText("Updated description")).toBeVisible();
  const { data: risk } = await db.from("risks").select("title,description,owner_id,likelihood,status").eq("id", riskId).eq("organisation_id", orgId).single();
  expect(risk?.title).toBe("Updated risk");
  expect(risk?.description).toBe("Updated description");
  expect(risk?.likelihood).toBe(5);
  expect(risk?.status).toBe("open");
  expect(risk?.owner_id).toBeTruthy();

  await page.goto(`/app/risks/${riskId}/edit`);
  const staleRiskPage = await page.context().newPage();
  await staleRiskPage.goto(`/app/risks/${riskId}/edit`);
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Latest risk title");
  await page.getByRole("button", { name: "Save risk" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/risks/${riskId}$`));
  await staleRiskPage.getByRole("textbox", { name: "Description", exact: true }).fill("Stale risk description retained");
  await staleRiskPage.getByRole("button", { name: "Save risk" }).click();
  await expect(staleRiskPage.locator("form").getByRole("alert")).toContainText("This risk changed");
  await expect(staleRiskPage.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("Stale risk description retained");
  await staleRiskPage.screenshot({ animations: "disabled", path: info.outputPath("risk-stale-save.png"), fullPage: true });
  const latestRisk = await db.from("risks").select("title,description").eq("id", riskId).eq("organisation_id", orgId).single();
  expect(latestRisk.data).toEqual({ title: "Latest risk title", description: "Updated description" });
  await staleRiskPage.close();

  await page.goto("/app/tasks/new");
  await expect(page.getByRole("group", { name: "Task brief" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Ownership and timing" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Linked records" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/app/tasks");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ animations: "disabled", path: info.outputPath("task-new.png"), fullPage: true });
  await page.getByLabel("Title", { exact: true }).fill("Original task");
  await page.getByLabel("Detail", { exact: true }).fill("Original detail");
  await page.getByLabel("Owner").selectOption({ label: ownerName });
  await page.getByLabel("Recurrence").selectOption("monthly");
  await page.getByLabel("Linked risk").selectOption(riskId);
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page).toHaveURL("/app/tasks");
  const taskLookup = await db.from("tasks").select("id").eq("organisation_id", orgId).eq("title", "Original task").single();
  expect(taskLookup.error).toBeNull(); if (!taskLookup.data) throw new Error("E2E task fixture was not created");
  const taskId = taskLookup.data.id;
  await page.goto(`/app/tasks/${taskId}`);
  await page.getByRole("link", { name: "Edit task" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/tasks/${taskId}/edit$`));
  await expect(page.getByText(/Changing the owner preserves earlier submissions/)).toBeVisible();
  await page.screenshot({ animations: "disabled", path: info.outputPath("task-edit.png"), fullPage: true });
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Updated task");
  await page.getByRole("textbox", { name: "Detail", exact: true }).fill("Updated detail");
  await page.getByLabel("Due date").fill("2026-12-31");
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/tasks/${taskId}$`));
  await expect(page.getByRole("heading", { name: "Updated task" })).toBeVisible();
  const { data: task } = await db.from("tasks").select("title,detail,owner_id,due_on,recurrence,status,source").eq("id", taskId).eq("organisation_id", orgId).single();
  expect(task).toMatchObject({ title: "Updated task", detail: "Updated detail", due_on: "2026-12-31", recurrence: "monthly", status: "open", source: "manual" });
  expect(task?.owner_id).toBeTruthy();

  if (!risk?.owner_id) throw new Error("E2E risk owner was not saved");
  const evidenceInsert = await db.from("evidence").insert({
    organisation_id: orgId, title: "Access review evidence", kind: "note",
    description: "Fictional evidence linked to the maintained risk.", status: "current", created_by: risk.owner_id,
  }).select("id").single();
  expect(evidenceInsert.error).toBeNull();
  if (!evidenceInsert.data) throw new Error("E2E evidence fixture was not created");
  const evidenceId = evidenceInsert.data.id;
  const evidenceLinkInsert = await db.from("evidence_links").insert({ organisation_id: orgId, evidence_id: evidenceId, risk_id: riskId, created_by: risk.owner_id });
  expect(evidenceLinkInsert.error).toBeNull();

  if (info.project.name === "mobile") {
    await page.goto("/app/risks");
    const cards = page.getByRole("list", { name: "Risk register cards" });
    await expect(cards.getByRole("link", { name: "Updated task", exact: true })).toBeVisible();
    await expect(cards.getByText("1 linked", { exact: false })).toBeVisible();
    await expect(cards.getByRole("button", { name: "Delete Latest risk title" })).toBeVisible();
    await page.screenshot({ animations: "disabled", path: info.outputPath("risk-register-connected-mobile.png"), fullPage: true });
  }

  await page.goto(`/app/risks/${riskId}`);
  await expect(page.getByRole("heading", { name: "Exposure decision" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Updated task" })).toHaveAttribute("href", `/app/tasks/${taskId}`);
  const linkedEvidence = page.getByRole("link", { name: "Access review evidence" });
  await expect(linkedEvidence).toHaveAttribute("href", `/app/evidence?evidence=${evidenceId}#evidence-${evidenceId}`);
  await expect(page.getByText("Free-text references are supporting notes.")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ animations: "disabled", path: info.outputPath("risk-detail-connected.png"), fullPage: true });
  await linkedEvidence.click();
  await expect(page).toHaveURL(new RegExp(`/app/evidence\\?evidence=${evidenceId}#evidence-${evidenceId}$`));
  await expect(page.locator(`#evidence-${evidenceId}`).getByRole("heading", { name: "Access review evidence" })).toBeVisible();

  await page.goto(`/app/tasks/${taskId}/edit`);
  const stalePage = await page.context().newPage();
  await stalePage.goto(`/app/tasks/${taskId}/edit`);
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Latest task title");
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/tasks/${taskId}$`));
  await stalePage.getByRole("textbox", { name: "Detail", exact: true }).fill("Stale unsaved detail");
  await stalePage.getByRole("button", { name: "Save task" }).click();
  await expect(stalePage.locator("form").getByRole("alert")).toContainText("This task changed");
  await expect(stalePage.getByRole("textbox", { name: "Detail", exact: true })).toHaveValue("Stale unsaved detail");
  await stalePage.screenshot({ animations: "disabled", path: info.outputPath("task-stale-save.png"), fullPage: true });
  const latest = await db.from("tasks").select("title,detail").eq("id", taskId).eq("organisation_id", orgId).single();
  expect(latest.data).toEqual({ title: "Latest task title", detail: "Updated detail" });
  await stalePage.close();
});

test("assessment completion hands off to a read-only control review", async ({ page }, info) => {
  test.setTimeout(90_000);
  const { db, orgId } = await workspace(page, info);
  await page.goto("/app/assessment");
  await page.getByRole("button", { name: "New assessment" }).click();
  await expect(page).toHaveURL(/\/app\/assessment\/[0-9a-f-]+$/);
  const assessmentUrl = page.url();
  const assessmentId = new URL(assessmentUrl).pathname.split("/").pop()!;
  const total = Number(await page.locator(".assessment-progress-summary progress").first().getAttribute("max"));
  expect(total).toBeGreaterThan(0);
  const announcement = page.getByRole("status", { name: "Question progress announcement" });
  for (let index = 0; index < total; index += 1) {
    await expect(announcement).toContainText(`Question ${index + 1} of ${total}.`);
    const save = page.waitForResponse((response) => response.url().includes("/api/app/assessment/response") && response.request().method() === "PATCH");
    await page.getByRole("radio", { name: "Yes", exact: true }).check();
    expect((await save).status()).toBe(200);
    await expect(page.getByRole("status", { name: "Save status" })).toHaveText("Saved");
    if (index < total - 1) {
      await page.getByRole("button", { name: "Save and continue", exact: true }).click();
      await expect(announcement).toContainText(`Question ${index + 2} of ${total}.`);
    }
  }
  const complete = page.waitForResponse((response) => response.url().includes("/api/app/assessment/complete") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save and complete", exact: true }).click();
  expect((await complete).status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`/app/assessment/${assessmentId}\\?completed=1$`));
  const session = await db.from("assessment_sessions").select("state,completed_at").eq("id", assessmentId).eq("organisation_id", orgId).single();
  expect(session.error).toBeNull();
  expect(session.data?.state).toBe("completed");
  expect(session.data?.completed_at).toBeTruthy();
  await expect(page.getByRole("status", { name: "Completion status" })).toContainText("Assessment completed.");
  await expect(page.getByRole("heading", { name: "Control review", exact: true })).toBeVisible();
  await expect(page.getByText(/reviewer still decides applicability, implementation status, ownership and rationale/i)).toBeVisible();
  await expect(page.getByText("Read-only assessment", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Yes", exact: true })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "Yes", exact: true })).toBeChecked();

  await page.getByRole("button", { name: "Review controls", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/soa\/[0-9a-f-]+$/);
  const registerId = new URL(page.url()).pathname.split("/").pop()!;
  const register = await db.from("soa_registers").select("assessment_session_id").eq("id", registerId).eq("organisation_id", orgId).single();
  expect(register.error).toBeNull();
  expect(register.data?.assessment_session_id).toBe(assessmentId);
  await expect(page.getByRole("heading", { name: "Statement of Applicability", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Control review context" })).toContainText("Active and editable");
  await expect(page.getByRole("heading", { name: "Review queue", exact: true })).toBeVisible();
});
