import { describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: () => Promise.resolve() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); } }));

import { changeMemberRoleAction, removeMemberAction, revokeInvitationAction } from "./actions";

// Minimal thenable supabase double: every builder method returns the same chain,
// which resolves to { error } when awaited (mirrors the real query builder).
function fakeSupabase(error: unknown = null) {
  const chain: Record<string, unknown> = {};
  for (const m of ["update", "delete", "eq", "is"]) chain[m] = () => chain;
  chain.then = (resolve: (v: { error: unknown }) => unknown) => resolve({ error });
  return { from: () => chain };
}
function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe("team lifecycle actions — authorisation", () => {
  const actions = [
    { name: "changeMemberRole", run: () => changeMemberRoleAction(fd({ userId: "u", role: "owner" })) },
    { name: "removeMember", run: () => removeMemberAction(fd({ userId: "u" })) },
    { name: "revokeInvitation", run: () => revokeInvitationAction(fd({ email: "x@y.z" })) },
  ];

  for (const a of actions) {
    it(`${a.name} refuses a non-owner`, async () => {
      hoisted.ctx = { membership: { role: "member" }, organisation: { id: "o1" }, supabase: fakeSupabase() };
      await expect(a.run()).rejects.toThrow("Only workspace owners");
    });
  }

  it("maps the retain-last-owner trigger error to friendly copy", async () => {
    hoisted.ctx = { membership: { role: "owner" }, organisation: { id: "o1" }, supabase: fakeSupabase({ message: "an organisation must retain at least one owner" }) };
    await expect(changeMemberRoleAction(fd({ userId: "u", role: "member" }))).rejects.toThrow("must keep at least one owner");
    await expect(removeMemberAction(fd({ userId: "u" }))).rejects.toThrow("must keep at least one owner");
  });

  it("lets an owner through when the write succeeds", async () => {
    hoisted.ctx = { membership: { role: "owner" }, organisation: { id: "o1" }, supabase: fakeSupabase(null) };
    await expect(removeMemberAction(fd({ userId: "u" }))).resolves.toBeUndefined();
    await expect(revokeInvitationAction(fd({ email: "x@y.z" }))).resolves.toBeUndefined();
  });

  it("rejects an invalid role value", async () => {
    hoisted.ctx = { membership: { role: "owner" }, organisation: { id: "o1" }, supabase: fakeSupabase() };
    await expect(changeMemberRoleAction(fd({ userId: "u", role: "superadmin" }))).rejects.toThrow("Invalid role");
  });
});
