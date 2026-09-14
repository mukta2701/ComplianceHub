import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("Task workspace-access ownership", () => {
  it.each([
    "src/app/app/tasks/page.tsx",
    "src/app/app/tasks/[id]/page.tsx",
    "src/app/app/tasks/new/page.tsx",
    "src/app/app/tasks/[id]/edit/page.tsx",
    "src/app/app/tasks/from-gap/page.tsx",
    "src/app/app/tasks/actions.ts",
    "src/app/app/tasks/contribution-actions.ts",
    "src/app/app/tasks/[id]/tracker-actions.ts",
  ])("routes task role decisions in %s through the shared section", (relativePath) => {
    const contents = source(relativePath);

    expect(contents).toContain("workspaceAccess");
    expect(contents).toContain('.section("tasks")');
    expect(contents).not.toMatch(/membership(?:\?|)\.role\s*(?:===|!==)/);
  });

  it("sources operator and Member task navigation from workspace access", () => {
    const contents = source("src/components/app-shell.tsx");

    expect(contents).toContain('workspaceAccess("owner").section("tasks").navigation');
    expect(contents).toContain('workspaceAccess("member").section("tasks").navigation');
    expect(contents).not.toContain('["/app/tasks", "check", "Tasks"]');
    expect(contents).not.toContain('["/app/tasks?filter=assigned", "check", "Assigned tasks"]');
  });

  it("passes shared task permissions into the contribution presentation without recreating role logic", () => {
    const detail = source("src/app/app/tasks/[id]/page.tsx");
    const presentation = source("src/app/app/tasks/task-contributions.tsx");
    const contributionDomain = source("src/features/tasks/domain/contributions.ts");

    expect(detail).toContain("canManage={canManage}");
    expect(presentation).toContain("canReview: props.canManage");
    expect(presentation).not.toContain("props.role");
    expect(contributionDomain).not.toContain("input.role");
  });

  it("keeps tracker delivery tied to connection authority through the task operation policy", () => {
    const policy = source("src/features/organisations/domain/workspace-access.ts");
    const tracker = source("src/app/app/tasks/[id]/tracker-actions.ts");

    expect(policy).toContain('"push-task-to-tracker": "manage_connections"');
    expect(tracker).toContain('requireManage("push-task-to-tracker")');
  });

  it("removes the standalone task route vocabulary after the shared policy replaces it", () => {
    const contents = source("src/features/organisations/domain/portal-access.ts");

    expect(contents).not.toContain("TASK_DETAIL_PATH");
    expect(contents).not.toContain('"/app/tasks"');
  });

  it("does not add an early role denial to assignee submission, gap acceptance, starter-calendar creation, or task export", () => {
    const contributionActions = source("src/app/app/tasks/contribution-actions.ts");
    const submit = contributionActions.slice(
      contributionActions.indexOf("export async function submitTaskContributionAction"),
      contributionActions.indexOf("export async function reviewTaskContributionAction"),
    );
    expect(submit).not.toContain("requireManage");

    const taskActions = source("src/app/app/tasks/actions.ts");
    const gap = taskActions.slice(
      taskActions.indexOf("export async function createGapTaskAction"),
      taskActions.indexOf("export async function acceptCalendarSeedAction"),
    );
    const calendar = taskActions.slice(taskActions.indexOf("export async function acceptCalendarSeedAction"));
    expect(gap).not.toContain("requireManage");
    expect(calendar).not.toContain("requireManage");

    const exportRoute = source("src/app/api/app/tasks/export/route.ts");
    expect(exportRoute).not.toContain("workspaceAccess");
    expect(exportRoute).not.toContain("hasCapability");
  });
});
