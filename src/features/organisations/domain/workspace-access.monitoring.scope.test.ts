import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("Monitoring workspace-access ownership", () => {
  it("routes Monitoring, its navigation and page presentation through the shared section", () => {
    const portal = read("src/features/organisations/domain/portal-access.ts");
    const shell = read("src/components/app-shell.tsx");
    const page = read("src/app/app/monitoring/page.tsx");

    expect(portal).not.toContain('"/app/monitoring"');
    expect(shell).toContain('section("monitoring")');
    expect(shell).not.toContain('["/app/monitoring", "activity", "Monitoring"]');
    expect(page).toContain('section("monitoring")');
    expect(page).not.toContain('membership.role === "member"');
    expect(page).not.toContain('hasCapability(membership.role, "manage_monitoring_findings")');
  });

  it("routes every Monitoring action gate through the shared section without moving later work", () => {
    const files = [
      "src/app/app/monitoring/actions.ts",
      "src/app/app/monitoring/github-actions.ts",
      "src/app/app/monitoring/github-control-room-actions.ts",
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).toContain('section("monitoring")');
      expect(source).not.toContain('membership.role !== "owner"');
      expect(source).not.toContain('context.membership.role !== "owner"');
      expect(source).not.toContain("hasCapability(");
    }
  });

  it("routes role-sensitive GitHub Monitoring controls through shared sections", () => {
    for (const file of [
      "src/features/github/components/github-collection-health-panel.tsx",
      "src/features/github/components/github-compliance-control-room.tsx",
      "src/features/github/components/github-record-provenance.tsx",
    ]) {
      const source = read(file);
      expect(source).toContain("workspaceAccess(role)");
      expect(source).not.toContain('role === "owner"');
      expect(source).not.toContain('role !== "owner"');
    }
  });

  it("keeps connection prompts tied to connection management and alert polling outside Monitoring management", () => {
    const healthPanel = read("src/features/github/components/github-collection-health-panel.tsx");
    const actions = read("src/app/app/monitoring/actions.ts");

    expect(healthPanel).toContain('section("connections").canManage');
    expect(actions).toContain("export async function fetchRecentAlertsAction");
  });
});
