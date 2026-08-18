import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/app/app/risks/page.tsx"), "utf8");

describe("risk matrix editor workspace contract", () => {
  it("imports and checks the operator-only capability before rendering the form", () => {
    expect(source).toContain('import { hasCapability } from "@/features/organisations/domain/access";');
    expect(source).toContain('hasCapability(membership.role, "manage_risk_matrix")');
    expect(source).toContain("Only workspace operators can change these thresholds.");
  });
});
