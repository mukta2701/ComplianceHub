import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ ctx: null as unknown }));
const INVITATION_ID = "40000000-0000-4000-8000-000000000004";

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: () => Promise.resolve() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); } }));

import { changeMemberRoleAction, removeMemberAction, revokeInvitationAction, updateMemberJobTitleAction } from "./actions";

// Minimal thenable supabase double: every builder method returns the same chain,
// which resolves to { error } when awaited (mirrors the real query builder).
function fakeSupabase(error: unknown = null, targetRole = "member") {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "update", "delete", "eq", "is"]) chain[m] = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: { role: targetRole }, error: null });
  chain.then = (resolve: (v: { error: unknown }) => unknown) => resolve({ error });
  return { from: () => chain, rpc: vi.fn().mockResolvedValue({ data: null, error }) };
}
function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("team lifecycle actions — authorisation", () => {
  it("refuses team management by an ordinary member", async () => {
    hoisted.ctx = { membership: { role: "member" }, organisation: { id: "o1" }, supabase: fakeSupabase() };
    await expect(removeMemberAction(fd({ userId: "u" }))).rejects.toThrow("not allowed");
    await expect(updateMemberJobTitleAction(fd({ userId: "u", jobTitle: "Developer" }))).rejects.toThrow("not allowed");
    await expect(revokeInvitationAction(fd({ invitationId: INVITATION_ID }))).rejects.toThrow("not allowed");
  });

  it("lets an admin update and remove ordinary members", async () => {
    hoisted.ctx = { membership: { role: "admin" }, organisation: { id: "o1" }, supabase: fakeSupabase(null, "member") };
    await expect(updateMemberJobTitleAction(fd({ userId: "u", jobTitle: "Developer" }))).resolves.toBeUndefined();
    await expect(removeMemberAction(fd({ userId: "u" }))).resolves.toBeUndefined();
  });

  for (const targetRole of ["owner", "admin"]) {
    it(`does not let an admin change or remove an ${targetRole}`, async () => {
      hoisted.ctx = { membership: { role: "admin" }, organisation: { id: "o1" }, supabase: fakeSupabase(null, targetRole) };
      await expect(updateMemberJobTitleAction(fd({ userId: "u", jobTitle: "Changed" }))).rejects.toThrow("not allowed");
      await expect(removeMemberAction(fd({ userId: "u" }))).rejects.toThrow("not allowed");
    });
  }

  it("does not let an admin change roles", async () => {
    hoisted.ctx = { membership: { role: "admin" }, organisation: { id: "o1" }, supabase: fakeSupabase() };
    await expect(changeMemberRoleAction(fd({ userId: "u", role: "admin" }))).rejects.toThrow("Only workspace owners");
  });

  it("maps the retain-last-owner trigger error to friendly copy", async () => {
    hoisted.ctx = { membership: { role: "owner" }, organisation: { id: "o1" }, supabase: fakeSupabase({ message: "an organisation must retain at least one owner" }) };
    await expect(changeMemberRoleAction(fd({ userId: "u", role: "member" }))).rejects.toThrow("must keep at least one owner");
    await expect(removeMemberAction(fd({ userId: "u" }))).rejects.toThrow("must keep at least one owner");
  });

  it("lets an owner through when the write succeeds", async () => {
    hoisted.ctx = { membership: { role: "owner" }, organisation: { id: "o1" }, supabase: fakeSupabase(null) };
    await expect(removeMemberAction(fd({ userId: "u" }))).resolves.toBeUndefined();
    await expect(revokeInvitationAction(fd({ invitationId: INVITATION_ID }))).resolves.toBeUndefined();
  });

  it("lets an owner assign the admin role", async () => {
    hoisted.ctx = { membership: { role: "owner" }, organisation: { id: "o1" }, supabase: fakeSupabase(null) };
    await expect(changeMemberRoleAction(fd({ userId: "u", role: "admin" }))).resolves.toBeUndefined();
  });

  it("rejects an invalid role value", async () => {
    hoisted.ctx = { membership: { role: "owner" }, organisation: { id: "o1" }, supabase: fakeSupabase() };
    await expect(changeMemberRoleAction(fd({ userId: "u", role: "superadmin" }))).rejects.toThrow("Invalid role");
  });
});
