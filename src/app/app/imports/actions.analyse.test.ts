import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  enforceRateLimit: vi.fn(),
  parseWorkbook: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("@/features/imports/parse", () => ({ parseWorkbook: hoisted.parseWorkbook }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { analyseImportAction, runImportAction } from "./actions";

function importForm() {
  const form = new FormData();
  form.set("module", "risk");
  form.set("file", new File(["Risk ID,Status\nR-001,Open"], "risks.csv", { type: "text/csv" }));
  return form;
}

describe("analyseImportAction security controls", () => {
  beforeEach(() => {
    hoisted.enforceRateLimit.mockReset().mockResolvedValue(undefined);
    hoisted.parseWorkbook.mockReset().mockResolvedValue({
      headers: ["Risk ID", "Status"],
      rows: [["R-001", "Open"]],
    });
  });

  it("does not let a Member analyse import files", async () => {
    hoisted.ctx = { user: { id: "member-1" }, membership: { role: "member" } };

    await expect(analyseImportAction(importForm())).resolves.toEqual({
      error: "You do not have permission to manage imports.",
    });
    expect(hoisted.enforceRateLimit).not.toHaveBeenCalled();
    expect(hoisted.parseWorkbook).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin"] as const)("rate-limits %s analysis before parsing", async (role) => {
    hoisted.ctx = { user: { id: `${role}-1` }, membership: { role } };

    const result = await analyseImportAction(importForm());

    expect(hoisted.enforceRateLimit).toHaveBeenCalledWith(`import-analyse:${role}-1`, {
      limit: 10,
      windowMs: 60_000,
    });
    expect(hoisted.enforceRateLimit.mock.invocationCallOrder[0]).toBeLessThan(
      hoisted.parseWorkbook.mock.invocationCallOrder[0],
    );
    expect(result).not.toHaveProperty("error");
  });

  it("returns a safe recovery message when the analysis limit is exceeded", async () => {
    hoisted.ctx = { user: { id: "owner-1" }, membership: { role: "owner" } };
    hoisted.enforceRateLimit.mockRejectedValue(new Error("Too many requests. Please wait and try again."));

    await expect(analyseImportAction(importForm())).resolves.toEqual({
      error: "Too many import attempts. Please wait and try again.",
    });
    expect(hoisted.parseWorkbook).not.toHaveBeenCalled();
  });

  it("does not let a Member bypass analysis and invoke an import directly", async () => {
    hoisted.ctx = { user: { id: "member-1" }, membership: { role: "member" } };

    await expect(runImportAction({
      module: "risk",
      headers: [],
      rows: [],
      mapping: {},
      commit: true,
    })).rejects.toThrow("You do not have permission to manage imports.");
    expect(hoisted.enforceRateLimit).not.toHaveBeenCalled();
  });
});
