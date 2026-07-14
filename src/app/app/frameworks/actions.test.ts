import { beforeEach, describe, expect, it, vi } from "vitest";

const ORGANISATION_ID = "20000000-0000-4000-8000-000000000001";
const USER_ID = "30000000-0000-4000-8000-000000000001";
const CONTROL_ID = "40000000-0000-4000-8000-000000000001";
const MAPPING_ID = "50000000-0000-4000-8000-000000000001";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  enforceRateLimit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));

import { addControlCrosswalkAction, deleteControlCrosswalkAction } from "./actions";

function mappingForm() {
  const form = new FormData();
  form.set("controlId", CONTROL_ID);
  form.set("framework", "soc_2");
  form.set("externalRef", "CC6.1");
  form.set("note", "Our reviewed access-control interpretation.");
  return form;
}

function deleteForm(id = MAPPING_ID) {
  const form = new FormData();
  form.set("id", id);
  return form;
}

describe("framework mapping actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([addControlCrosswalkAction, deleteControlCrosswalkAction])(
    "rejects Members before rate limiting or database writes",
    async (action) => {
      const from = vi.fn();
      hoisted.ctx = {
        supabase: { from }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID },
        membership: { role: "member" },
      };

      await expect(action(action === addControlCrosswalkAction ? mappingForm() : deleteForm()))
        .rejects.toThrow("Only workspace operators can manage framework mappings");
      expect(hoisted.enforceRateLimit).not.toHaveBeenCalled();
      expect(from).not.toHaveBeenCalled();
    },
  );

  for (const role of ["owner", "admin"] as const) {
    it(`lets ${role}s add a mapping using only trusted tenant and actor values`, async () => {
      const insert = vi.fn().mockResolvedValue({ error: null });
      hoisted.ctx = {
        supabase: { from: vi.fn(() => ({ insert })) }, user: { id: USER_ID },
        organisation: { id: ORGANISATION_ID }, membership: { role },
      };

      await addControlCrosswalkAction(mappingForm());

      expect(insert).toHaveBeenCalledWith({
        organisation_id: ORGANISATION_ID,
        control_id: CONTROL_ID,
        framework: "soc_2",
        external_ref: "CC6.1",
        note: "Our reviewed access-control interpretation.",
        created_by: USER_ID,
      });
    });
  }

  it("parses delete IDs as UUIDs before touching the database", async () => {
    const from = vi.fn();
    hoisted.ctx = {
      supabase: { from }, user: { id: USER_ID }, organisation: { id: ORGANISATION_ID },
      membership: { role: "owner" },
    };

    await expect(deleteControlCrosswalkAction(deleteForm("not-a-uuid"))).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
  });

  it("scopes deletion to the active organisation and fails closed when no row matches", async () => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    builder.delete = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.select = vi.fn(() => builder);
    builder.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => builder) }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID }, membership: { role: "admin" },
    };

    await expect(deleteControlCrosswalkAction(deleteForm()))
      .rejects.toThrow("Mapping was not found in this workspace");
    expect(builder.eq).toHaveBeenCalledWith("id", MAPPING_ID);
    expect(builder.eq).toHaveBeenCalledWith("organisation_id", ORGANISATION_ID);
    expect(builder.select).toHaveBeenCalledWith("id");
  });

  it("removes an exact active-workspace mapping", async () => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    builder.delete = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.select = vi.fn(() => builder);
    builder.maybeSingle = vi.fn().mockResolvedValue({ data: { id: MAPPING_ID }, error: null });
    hoisted.ctx = {
      supabase: { from: vi.fn(() => builder) }, user: { id: USER_ID },
      organisation: { id: ORGANISATION_ID }, membership: { role: "owner" },
    };

    await expect(deleteControlCrosswalkAction(deleteForm())).resolves.toBeUndefined();
    expect(hoisted.revalidatePath).toHaveBeenCalledWith("/app/frameworks");
  });
});
