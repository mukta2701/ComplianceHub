import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

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
  await expect(page.getByRole("heading", { name: "Readiness dashboard" })).toBeVisible();
  const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password: pass });
  expect(signIn.error).toBeNull();
  const { data: org } = await admin().from("organisations").select("id").eq("name", organisation).single();
  if (!org) throw new Error("E2E workspace was not found");
  return { db, orgId: org.id, ownerEmail: email, ownerPassword: pass, ownerName: "Maintenance Owner" };
}
test("risk and task metadata edits persist without changing status or source", async ({ page }, info) => {
  test.setTimeout(90_000);
  const { db, orgId, ownerName } = await workspace(page, info);
  await page.goto("/app/risks/new");
  await page.getByLabel("Reference", { exact: true }).fill("R-MAINT");
  await page.getByLabel("Title", { exact: true }).fill("Original risk");
  await page.getByLabel("Description", { exact: true }).fill("Original description");
  await page.getByLabel("Category").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Save risk" }).click();
  await expect(page).toHaveURL("/app/risks");
  const riskLookup = await db.from("risks").select("id").eq("organisation_id", orgId).eq("reference", "R-MAINT").single();
  expect(riskLookup.error).toBeNull(); if (!riskLookup.data) throw new Error("E2E risk fixture was not created");
  const riskId = riskLookup.data.id;
  await page.goto(`/app/risks/${riskId}`);
  await page.getByRole("link", { name: "Edit risk" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/risks/${riskId}/edit$`));
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Updated risk");
  await page.getByRole("textbox", { name: "Description", exact: true }).fill("Updated description");
  await page.getByRole("combobox", { name: "Likelihood", exact: true }).selectOption("5");
  await page.getByLabel("Owner").selectOption({ label: ownerName });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/risks/${riskId}$`));
  await expect(page.getByRole("heading", { name: "Updated risk" })).toBeVisible();
  await expect(page.getByText("Updated description")).toBeVisible();
  const { data: risk } = await db.from("risks").select("title,description,owner_id,likelihood,status").eq("id", riskId).eq("organisation_id", orgId).single();
  expect(risk?.title).toBe("Updated risk");
  expect(risk?.description).toBe("Updated description");
  expect(risk?.likelihood).toBe(5);
  expect(risk?.status).toBe("open");
  expect(risk?.owner_id).toBeTruthy();

  await page.goto("/app/tasks/new");
  await page.getByLabel("Title", { exact: true }).fill("Original task");
  await page.getByLabel("Detail", { exact: true }).fill("Original detail");
  await page.getByLabel("Owner").selectOption({ label: ownerName });
  await page.getByLabel("Recurrence").selectOption("monthly");
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page).toHaveURL("/app/tasks");
  const taskLookup = await db.from("tasks").select("id").eq("organisation_id", orgId).eq("title", "Original task").single();
  expect(taskLookup.error).toBeNull(); if (!taskLookup.data) throw new Error("E2E task fixture was not created");
  const taskId = taskLookup.data.id;
  await page.goto(`/app/tasks/${taskId}`);
  await page.getByRole("link", { name: "Edit task" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/tasks/${taskId}/edit$`));
  await page.getByRole("textbox", { name: "Title", exact: true }).fill("Updated task");
  await page.getByRole("textbox", { name: "Detail", exact: true }).fill("Updated detail");
  await page.getByLabel("Due date").fill("2026-12-31");
  await page.getByRole("button", { name: "Save task" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/tasks/${taskId}$`));
  await expect(page.getByRole("heading", { name: "Updated task" })).toBeVisible();
  const { data: task } = await db.from("tasks").select("title,detail,owner_id,due_on,recurrence,status,source").eq("id", taskId).eq("organisation_id", orgId).single();
  expect(task).toMatchObject({ title: "Updated task", detail: "Updated detail", due_on: "2026-12-31", recurrence: "monthly", status: "open", source: "manual" });
  expect(task?.owner_id).toBeTruthy();
});

test("assessment completion becomes read-only and remains available for SoA draft", async ({ page }, info) => {
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
  await expect(page).toHaveURL(/\/app\/assessment(?:\?.*)?$/);
  const session = await db.from("assessment_sessions").select("state,completed_at").eq("id", assessmentId).eq("organisation_id", orgId).single();
  expect(session.error).toBeNull();
  expect(session.data?.state).toBe("completed");
  expect(session.data?.completed_at).toBeTruthy();
  await page.goto(assessmentUrl);
  await expect(page.getByText("Read-only assessment", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Yes", exact: true })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "Yes", exact: true })).toBeChecked();
  await page.goto("/app/soa");
  const select = page.locator('select[name="assessmentId"]');
  await select.selectOption(assessmentId);
  await page.getByRole("button", { name: "Generate draft" }).click();
  await expect(page).toHaveURL(/\/app\/soa\/[0-9a-f-]+$/);
  const registerId = new URL(page.url()).pathname.split("/").pop()!;
  const register = await db.from("soa_registers").select("assessment_session_id").eq("id", registerId).eq("organisation_id", orgId).single();
  expect(register.error).toBeNull();
  expect(register.data?.assessment_session_id).toBe(assessmentId);
  await expect(page.getByRole("heading", { name: "Review queue", exact: true })).toBeVisible();
});
