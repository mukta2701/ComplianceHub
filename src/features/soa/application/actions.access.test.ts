import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: hoisted.redirect }));

import { createAssessmentAction, createSoaAction, createSoaSuccessorAction } from "./actions";

const CATALOGUE_ID = "10000000-0000-4000-8000-000000000001";
const ASSESSMENT_ID = "10000000-0000-4000-8000-000000000002";
const REGISTER_ID = "10000000-0000-4000-8000-000000000003";
const SUCCESSOR_ID = "10000000-0000-4000-8000-000000000004";

function form(field: string, value: string) {
  const data = new FormData();
  data.set(field, value);
  return data;
}

function context(role: "owner" | "admin" | "member") {
  const assessmentQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: ASSESSMENT_ID }, error: null }),
  };
  assessmentQuery.select.mockReturnValue(assessmentQuery);
  assessmentQuery.eq.mockReturnValue(assessmentQuery);

  const registerQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: REGISTER_ID }, error: null }),
  };
  registerQuery.select.mockReturnValue(registerQuery);
  registerQuery.eq.mockReturnValue(registerQuery);

  const assessmentInsert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({ data: { id: ASSESSMENT_ID }, error: null }),
    })),
  }));
  const catalogueSingle = vi.fn().mockResolvedValue({ data: { id: CATALOGUE_ID }, error: null });
  const catalogueQuery = {
    select: vi.fn(),
    not: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(() => ({ single: catalogueSingle })),
  };
  catalogueQuery.select.mockReturnValue(catalogueQuery);
  catalogueQuery.not.mockReturnValue(catalogueQuery);
  catalogueQuery.order.mockReturnValue(catalogueQuery);

  const from = vi.fn((table: string) => {
    if (table === "catalogue_versions") return catalogueQuery;
    if (table === "assessment_sessions") return { ...assessmentQuery, insert: assessmentInsert };
    if (table === "soa_registers") return registerQuery;
    throw new Error(`Unexpected table: ${table}`);
  });
  const rpc = vi.fn(async (name: string) => ({
    data: name === "create_or_reuse_soa_successor" ? SUCCESSOR_ID : REGISTER_ID,
    error: null,
  }));

  hoisted.ctx = {
    supabase: { from, rpc },
    user: { id: "user-1" },
    organisation: { id: "org-1" },
    membership: { role },
  };
  return { from, rpc };
}

describe("assessment and SoA creation access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects Members before any assessment database work", async () => {
    const database = context("member");

    await expect(createAssessmentAction()).rejects.toThrow("Only workspace operators can complete assessments.");

    expect(database.from).not.toHaveBeenCalled();
    expect(database.rpc).not.toHaveBeenCalled();
  });

  it("rejects Members before any initial SoA database work", async () => {
    const database = context("member");

    await expect(createSoaAction(form("assessmentId", ASSESSMENT_ID))).rejects.toThrow(
      "Only workspace Owners and Admins can finalise a Statement of Applicability",
    );

    expect(database.from).not.toHaveBeenCalled();
    expect(database.rpc).not.toHaveBeenCalled();
  });

  it("rejects Members before any successor SoA database work", async () => {
    const database = context("member");

    await expect(createSoaSuccessorAction(form("registerId", REGISTER_ID))).rejects.toThrow(
      "Only workspace Owners and Admins can finalise a Statement of Applicability",
    );

    expect(database.from).not.toHaveBeenCalled();
    expect(database.rpc).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin"] as const)("preserves successful creation for %ss", async (role) => {
    const database = context(role);

    await expect(createAssessmentAction()).rejects.toThrow(`REDIRECT:/app/assessment/${ASSESSMENT_ID}`);
    await expect(createSoaAction(form("assessmentId", ASSESSMENT_ID))).rejects.toThrow(`REDIRECT:/app/soa/${REGISTER_ID}`);
    await expect(createSoaSuccessorAction(form("registerId", REGISTER_ID))).rejects.toThrow(`REDIRECT:/app/soa/${SUCCESSOR_ID}`);

    expect(database.rpc).toHaveBeenCalledTimes(2);
  });
});
