import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/app/app/risks/page.tsx"), "utf8");

describe("risk matrix editor workspace contract", () => {
  it("uses the shared Risk-register access decision before rendering the form", () => {
    expect(source).toContain('import { workspaceAccess } from "@/features/organisations/domain/workspace-access";');
    expect(source).toContain('workspaceAccess(membership.role).section("risks")');
    expect(source).toContain("Only workspace operators can change these thresholds.");
  });
});
