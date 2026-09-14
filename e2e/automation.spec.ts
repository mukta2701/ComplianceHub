import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

function createTestPassword(seed: string): string {
  const digest = createHash("sha256").update(`playwright:${seed}`).digest("hex").slice(0, 24);
  return `E2e-${digest}-Aa1!`;
}

function localEnvironment(name: string): string {
  if (process.env[name]) return process.env[name] as string;
  const envPath = path.join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) throw new Error(`${name} is required for this end-to-end test`);
  const line = readFileSync(envPath, "utf8")
    .split("\n")
    .find((candidate) => candidate.startsWith(`${name}=`));
  if (!line) throw new Error(`${name} is required for this end-to-end test`);
  return line.slice(name.length + 1);
}

async function confirmLocalUser(email: string): Promise<void> {
  const admin = createClient(
    localEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    localEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  let userId: string | null = null;
  for (let page = 1; page <= 10 && userId === null; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1_000 });
    if (error) throw error;
    userId = data.users.find((user) => user.email === email)?.id ?? null;
    if (data.users.length < 1_000) break;
  }
  if (!userId) throw new Error("Synthetic automation user was not found for confirmation");
  const { error } = await admin.auth.admin.updateUserById(userId, { email_confirm: true });
  if (error) throw error;
}

async function completeE2eSignUp(page: Page, email: string, password: string): Promise<void> {
  await Promise.all([
    page.waitForURL((url) => ["/sign-in", "/app", "/app/onboarding"].includes(url.pathname)),
    page.getByRole("button", { name: "Create account" }).click(),
  ]);
  await confirmLocalUser(email);
  if (new URL(page.url()).pathname === "/sign-in") {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page.getByRole("heading", { name: "Create your organisation" })).toBeVisible();
}

async function submitServerAction(page: Page, button: Locator, pathname: string): Promise<void> {
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === pathname,
  );
  const [response] = await Promise.all([responsePromise, button.click()]);
  expect(response.status()).toBeLessThan(400);
}

test("a workspace turns selected systems into reviewable automation evidence", async ({ page }, testInfo) => {
  const suffix = `${Date.now()}-${testInfo.project.name}`;
  const email = `automation-${suffix}@example.test`;
  const password = createTestPassword(suffix);
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Automation Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await completeE2eSignUp(page, email, password);
  await page.getByLabel("Organisation name").fill(`Automation Workspace ${suffix}`);
  await submitServerAction(page, page.getByRole("button", { name: "Create workspace" }), "/app");
  // The server action response can arrive before the redirect finishes. Wait
  // for the authenticated dashboard before requesting the setup page, or a
  // fast suite run can race the membership cookie/schema write.
  await expect(page.getByRole("heading", { name: "Programme overview" })).toBeVisible();
  await page.goto("/app/setup");
  await expect(page.getByRole("heading", { name: "Connect the systems that already know your work" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Save setup and open Automation" }).click();
  await expect(page.getByRole("heading", { name: "Review the work your systems prepared" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByRole("button", { name: "Generate baseline" }).click();
  await expect(page.getByRole("heading", { name: "Review GitHub branch protection evidence" })).toBeVisible();
  const githubDraft = page.getByLabel("Automation draft: Review GitHub branch protection evidence");
  await githubDraft.getByRole("button", { name: "Use as draft" }).click();
  await expect(page.getByRole("status").filter({ hasText: /selected as a draft/i })).toBeVisible();
  await githubDraft.getByRole("button", { name: "Accept as evidence" }).click();
  await expect(githubDraft.getByRole("button", { name: "Confirm acceptance" })).toBeVisible();
  await githubDraft.getByRole("button", { name: "Confirm acceptance" }).click({ force: true });
  await expect(page.getByRole("status").filter({ hasText: "Evidence accepted" })).toContainText("Review GitHub branch protection evidence");
  await expect(githubDraft).toHaveCount(0);
  await page.goto("/app/evidence");
  await expect(page.getByRole("heading", { name: "Review GitHub branch protection evidence" })).toBeVisible();
});
