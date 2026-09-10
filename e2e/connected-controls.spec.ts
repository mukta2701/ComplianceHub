import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createTeamFixture, signIn, teamTestEnabled } from "./helpers/team-workspace";

test.skip(!teamTestEnabled || process.env.COMPLIANCEHUB_UI_DEMO !== "1", "Isolated fictional local controls demonstration only.");

async function openControl(page: Page, title: string) {
  const queue = page.getByRole("region", { name: "SoA review queue" });
  await page.getByRole("searchbox", { name: "Search controls" }).fill(title);
  await expect(queue.getByText(/^1 of \d+$/)).toBeVisible();
  const row = queue.getByRole("listitem").filter({ hasText: title });
  await row.getByRole("button", { name: /Review/ }).click();
  await expect(page.getByRole("form", { name: /Review/ })).toBeVisible();
  return row;
}

test.describe.serial("connected controls workspace", () => {
  let fixture: Awaited<ReturnType<typeof createTeamFixture>>;
  let assessmentId: string;
  let mappedControlId: string;
  let mappedItemId: string;
  let mappedControlTitle: string;
  let mappedQuestion: { code: string; id: string; prompt: string };
  let registerUrl: string;

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    fixture = await createTeamFixture();
    const { data: catalogue, error: catalogueError } = await fixture.coordinator.from("catalogue_versions")
      .select("id").not("published_at", "is", null).order("published_at", { ascending: false }).limit(1).single();
    expect(catalogueError).toBeNull();
    if (!catalogue) throw new Error("Published fictional assessment catalogue is unavailable");

    const { data: questions, error: questionsError } = await fixture.coordinator.from("catalogue_questions")
      .select("id,code,prompt").eq("catalogue_version_id", catalogue.id).order("position").limit(500);
    expect(questionsError).toBeNull();
    const { data: mappings, error: mappingError } = await fixture.coordinator.from("assessment_control_mappings")
      .select("catalogue_question_id,control_id").in("catalogue_question_id", (questions ?? []).map((question) => question.id)).limit(1);
    expect(mappingError).toBeNull();
    const mapping = mappings?.[0];
    const question = questions?.find((item) => item.id === mapping?.catalogue_question_id);
    if (!mapping || !question) throw new Error("Fictional mapped assessment question is unavailable");
    mappedQuestion = question;

    const { data: assessment, error: assessmentError } = await fixture.coordinator.from("assessment_sessions").insert({
      organisation_id: fixture.organisationId,
      catalogue_version_id: catalogue.id,
      title: "Fictional connected controls assessment",
      created_by: fixture.actors[0].id,
    }).select("id").single();
    expect(assessmentError).toBeNull();
    if (!assessment) throw new Error("Fictional assessment was not created");
    assessmentId = assessment.id;

    const { error: answerError } = await fixture.coordinator.rpc("save_assessment_response", {
      target_session_id: assessmentId,
      target_question_id: question.id,
      target_answer: "partially",
      target_evidence_note: "Fictional quarterly review notes",
      expected_revision: 0,
    });
    expect(answerError).toBeNull();

    const reviewStatus = await fixture.coordinator.from("soa_registers")
      .select("id,assessment_session_id,version,updated_at,soa_snapshots!soa_snapshots_register_tenant_fk(id)", { count: "exact" })
      .eq("assessment_session_id", assessmentId).eq("organisation_id", fixture.organisationId)
      .order("updated_at", { ascending: false }).order("version", { ascending: false }).order("id", { ascending: false }).limit(100);
    expect(reviewStatus.error).toBeNull();
    expect(reviewStatus.count).toBe(reviewStatus.data?.length);

    mappedControlId = mapping.control_id;
  });

  test("assessment context flows into the control review", async ({ page }) => {
    await signIn(page, fixture.actors[0]);
    await page.goto(`/app/assessment/${assessmentId}`);
    await expect(page.getByText(/control review will use incomplete source context/i)).toBeVisible();
    await page.getByRole("button", { name: "Review controls" }).click();
    await page.waitForURL(/\/app\/soa\/[0-9a-f-]+$/);
    registerUrl = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { name: "Work remains before finalisation", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Finalisation readiness" })).toContainText("93 pending");
    const registerId = registerUrl.split("/").pop()!;
    const { data: mappedItem, error: itemError } = await fixture.coordinator.from("soa_items")
      .select("id,control_title").eq("soa_register_id", registerId).eq("control_id", mappedControlId).single();
    expect(itemError).toBeNull();
    if (!mappedItem) throw new Error("Mapped fictional control was not seeded");
    mappedItemId = mappedItem.id;
    mappedControlTitle = mappedItem.control_title;

    const row = await openControl(page, mappedControlTitle);
    await expect(row).toContainText("mapped source answer");
    const source = page.getByRole("region", { name: /Assessment context for/ });
    await expect(source.getByText(mappedQuestion.code, { exact: true })).toBeVisible();
    await expect(source.getByText("Partially", { exact: true })).toBeVisible();
    await expect(source.getByText("Supporting note", { exact: true }).locator("..")).toContainText("Fictional quarterly review notes");
    await expect(source.getByText(/does not decide applicability.*not frozen/i)).toBeVisible();
  });

  test("the Owner receives saved decision feedback", async ({ page }) => {
    await signIn(page, fixture.actors[0]);
    await page.goto(registerUrl);
    await openControl(page, mappedControlTitle);
    await page.getByRole("combobox", { name: "Implementation status", exact: true }).selectOption("in_progress");
    await page.getByRole("combobox", { name: "Owner assignment", exact: true }).selectOption(fixture.actors[0].id);
    await page.getByRole("textbox", { name: "Rationale", exact: true }).fill("Fictional control decision recorded by the coordinator.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");
  });

  test("a stale control decision remains visible after a guarded save conflict", async ({ page }) => {
    await signIn(page, fixture.actors[0]);
    await page.goto(registerUrl);
    await openControl(page, mappedControlTitle);

    const { data: currentItem, error: currentItemError } = await fixture.coordinator.from("soa_items")
      .select("applicable,status,justification,evidence,owner_id,decision_revision").eq("id", mappedItemId).single();
    expect(currentItemError).toBeNull();
    if (!currentItem) throw new Error("Current fictional control decision is unavailable");
    const { error: concurrentSaveError } = await fixture.coordinator.rpc("update_soa_decisions_guarded", {
      target_register_id: registerUrl.split("/").pop()!,
      changes: [{
        itemId: mappedItemId,
        expectedRevision: currentItem.decision_revision,
        applicable: currentItem.applicable,
        status: currentItem.status,
        justification: "A concurrent fictional decision for the conflict demonstration.",
        evidence: currentItem.evidence,
        ownerId: currentItem.owner_id,
      }],
    });
    expect(concurrentSaveError).toBeNull();

    await page.getByRole("textbox", { name: "Rationale", exact: true }).fill("A stale fictional decision that must remain visible.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("status")).toContainText("changed after you opened it", { timeout: 15_000 });
    await expect(page.getByRole("textbox", { name: "Rationale", exact: true })).toHaveValue("A stale fictional decision that must remain visible.");
    await expect(page.getByRole("button", { name: "Refresh current decisions" })).toBeVisible();
  });

  test("the landing page reuses the active review and separates formal outputs", async ({ page }) => {
    await signIn(page, fixture.actors[0]);
    await page.goto("/app/soa");
    await expect(page.getByText("Editable working decisions", { exact: true })).toBeVisible();
    await expect(page.getByText("Immutable formal outputs", { exact: true })).toBeVisible();
    await page.getByLabel("Source assessment").selectOption(assessmentId);
    await page.getByRole("button", { name: "Start control review" }).click();
    await expect(page).toHaveURL(new RegExp(`${registerUrl}$`));
  });

  test("the review workspace remains accessible at each target width", async ({ page }, testInfo) => {
    await signIn(page, fixture.actors[0]);
    await page.goto(registerUrl);
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 1000 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await expect(page.getByRole("progressbar", { name: /controls reviewed/ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(scan.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")).toEqual([]);
      const layout = await page.evaluate(() => ({
        documentScrollHeight: document.documentElement.scrollHeight,
        bodyScrollHeight: document.body.scrollHeight,
        main: (() => { const rect = document.querySelector("main")?.getBoundingClientRect(); return rect ? { top: rect.top, height: rect.height, bottom: rect.bottom } : null; })(),
        sticky: [...document.querySelectorAll(".soa-review-toolbar,.soa-review-detail")].map((element) => ({ className: element.className, position: getComputedStyle(element).position, height: element.getBoundingClientRect().height })),
      }));
      expect(layout.main).not.toBeNull();
      expect(layout.main!.bottom).toBeLessThanOrEqual(layout.bodyScrollHeight);
      expect(layout.sticky.map((element) => element.position)).toEqual(viewport.width === 1440 ? ["sticky", "sticky"] : ["static", "static"]);
      await page.screenshot({ animations: "disabled", path: testInfo.outputPath(`connected-controls-${viewport.width}-viewport.png`) });
      await page.locator(".soa-review-layout").screenshot({
        animations: "disabled",
        path: testInfo.outputPath(`connected-controls-${viewport.width}-workspace.png`),
      });
    }
  });

  test("Member access stays read-only on mobile", async ({ browser }, testInfo) => {
    const memberContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL as string, viewport: { width: 390, height: 844 } });
    const memberPage = await memberContext.newPage();
    await signIn(memberPage, fixture.actors[1]);
    await memberPage.goto(registerUrl);
    await openControl(memberPage, mappedControlTitle);
    await expect(memberPage.getByRole("combobox", { name: "Applicability decision", exact: true })).toBeDisabled();
    await expect(memberPage.getByRole("combobox", { name: "Owner assignment", exact: true })).toBeDisabled();
    await expect(memberPage.getByRole("button", { name: "Save draft" })).toHaveCount(0);
    expect(await memberPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await memberContext.close();
  });

  test("a reviewed control workspace becomes an immutable Statement of Applicability", async ({ page }) => {
    await signIn(page, fixture.actors[0]);
    const registerId = registerUrl.split("/").pop()!;
    const { data: items, error: itemsError } = await fixture.coordinator.from("soa_items")
      .select("id,control_id,decision_revision,applicable,status,justification,evidence,owner_id")
      .eq("soa_register_id", registerId).order("position");
    expect(itemsError).toBeNull();
    expect(items).toHaveLength(93);

    const { data: requirementMapping, error: mappingError } = await fixture.coordinator.from("requirement_control_mappings")
      .select("control_id").eq("requirement_id", items?.find((item) => item.id === mappedItemId)?.control_id).single();
    expect(mappingError).toBeNull();
    if (!requirementMapping) throw new Error("Fictional control evidence mapping is unavailable");

    const evidence = await fixture.coordinator.rpc("create_evidence_record", {
      payload: {
        organisation_id: fixture.organisationId,
        title: "Fictional current control evidence",
        kind: "note",
        storage_path: null,
        url: null,
        description: "Fictional evidence created to demonstrate finalisation preconditions.",
        owner_id: fixture.actors[0].id,
        collected_on: new Date().toISOString().slice(0, 10),
        valid_until: null,
        review_interval: null,
        status: "current",
        replaces_evidence_id: null,
      },
    });
    expect(evidence.error).toBeNull();
    expect(evidence.data).toBeTruthy();
    const evidenceLink = await fixture.coordinator.from("evidence_links").insert({
      organisation_id: fixture.organisationId,
      evidence_id: evidence.data,
      control_id: requirementMapping.control_id,
      created_by: fixture.actors[0].id,
    });
    expect(evidenceLink.error).toBeNull();

    const finalisable = (items ?? []).map((item) => ({
      itemId: item.id,
      expectedRevision: item.decision_revision,
      applicable: item.id === mappedItemId,
      status: item.id === mappedItemId ? "operational" : "not_applicable",
      justification: item.id === mappedItemId ? "Fictional reviewed control with current evidence." : "Outside the fictional demonstration scope.",
      evidence: item.id === mappedItemId ? "Fictional current control evidence" : "",
      ownerId: item.id === mappedItemId ? fixture.actors[0].id : null,
    }));
    for (let start = 0; start < finalisable.length; start += 25) {
      const changes = finalisable.slice(start, start + 25);
      const result = await fixture.coordinator.rpc("update_soa_decisions_guarded", { target_register_id: registerId, changes });
      expect(result.error).toBeNull();
      expect(result.data).toHaveLength(changes.length);
    }

    await page.goto(registerUrl);
    await expect(page.getByRole("heading", { name: "Ready to create the formal statement", exact: true })).toBeVisible();
    const finalise = page.getByRole("button", { name: /Finalise immutable/ });
    await expect(finalise).toBeVisible();
    await finalise.click();
    await expect(page).toHaveURL(/\/app\/soa\?finalised=[0-9a-f-]+$/);
    const redirectedFormalOutput = page.locator(".soa-formal-list article").filter({ hasText: "STATEMENT OF APPLICABILITY" });
    await expect(redirectedFormalOutput.getByText("Finalised", { exact: true })).toBeVisible();
    await redirectedFormalOutput.getByRole("link", { name: "Review finalised statement" }).click();
    await expect(page).toHaveURL(new RegExp(`${registerUrl}$`));
    await expect(page.getByRole("heading", { name: "Statement of Applicability", exact: true })).toBeVisible();
    await expect(page.getByText("These saved decisions are immutable.", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Saved statement provenance", exact: true })).toBeVisible();
    await expect(page.getByText(/current answers, state and revision are not part of this saved statement/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "93 saved control decisions", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Finalise immutable/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save and next" })).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Applicability decision", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "SoA review queue" })).toHaveCount(0);

    const { data: snapshot, error: snapshotError } = await fixture.coordinator.from("soa_snapshots")
      .select("items").eq("soa_register_id", registerId).single();
    expect(snapshotError).toBeNull();
    expect(snapshot?.items).toEqual(expect.arrayContaining([expect.objectContaining({
      applicable: true,
      status: "operational",
      justification: "Fictional reviewed control with current evidence.",
      evidence: "Fictional current control evidence",
    })]));

    await page.goto("/app/soa");
    await expect(page.getByRole("heading", { name: "Finalised statements", exact: true })).toBeVisible();
    await expect(page.getByText("Immutable formal outputs", { exact: true })).toBeVisible();
    const formalOutput = page.locator(".soa-formal-list article").filter({ hasText: "STATEMENT OF APPLICABILITY" });
    await expect(formalOutput.getByText("Finalised", { exact: true })).toBeVisible();
    await expect(formalOutput.getByRole("link", { name: "Review finalised statement" })).toBeVisible();
    await expect(formalOutput.getByRole("button", { name: /Edit|Save|Finalise/ })).toHaveCount(0);
  });
});
