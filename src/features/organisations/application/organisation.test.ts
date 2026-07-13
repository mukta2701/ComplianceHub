import { describe, expect, it, vi } from "vitest";
import { createOrganisation, inviteMember, organisationInputSchema } from "./organisation";

describe("organisation application service", () => {
  it("normalises a valid organisation name and derives its slug", async () => {
    const insert = vi.fn().mockResolvedValue({ id: "org-1", name: "Acme Security", slug: "acme-security" });
    const result = await createOrganisation({ name: "  Acme Security  " }, { userId: "user-1", insert });
    expect(result).toEqual({ id: "org-1", name: "Acme Security", slug: "acme-security" });
    expect(insert).toHaveBeenCalledWith({ name: "Acme Security", slug: "acme-security", createdBy: "user-1" });
  });

  it("rejects an empty organisation name", () => {
    expect(organisationInputSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("permits an admin to invite a member with a normalised email and job title", async () => {
    const insertInvitation = vi.fn().mockResolvedValue({ id: "invite-1" });
    await expect(inviteMember(
      { organisationId: "00000000-0000-4000-8000-000000000001", email: " PERSON@Example.COM ", role: "member", jobTitle: " Developer " },
      { actorId: "user-1", actorRole: "admin", insertInvitation },
    )).resolves.toEqual({ id: "invite-1", token: expect.any(String) });
    expect(insertInvitation).toHaveBeenCalledWith(expect.objectContaining({ email: "person@example.com", jobTitle: "Developer", invitedBy: "user-1" }));
  });

  it("permits only owners to invite admins", async () => {
    const input = { organisationId: "00000000-0000-4000-8000-000000000001", email: "person@example.com", role: "admin" };
    await expect(inviteMember(input, { actorId: "user-1", actorRole: "admin", insertInvitation: vi.fn() }))
      .rejects.toThrow("cannot invite that role");
    await expect(inviteMember(input, { actorId: "user-1", actorRole: "owner", insertInvitation: vi.fn().mockResolvedValue({ id: "invite-1" }) }))
      .resolves.toEqual({ id: "invite-1", token: expect.any(String) });
  });

  it("rejects owner invitations and overlong job titles", async () => {
    const base = { organisationId: "00000000-0000-4000-8000-000000000001", email: "person@example.com" };
    await expect(inviteMember({ ...base, role: "owner" }, { actorId: "user-1", actorRole: "owner", insertInvitation: vi.fn() }))
      .rejects.toThrow();
    await expect(inviteMember({ ...base, role: "member", jobTitle: "x".repeat(121) }, { actorId: "user-1", actorRole: "owner", insertInvitation: vi.fn() }))
      .rejects.toThrow();
  });

  it("rejects member-created invitations", async () => {
    await expect(inviteMember(
      { organisationId: "00000000-0000-4000-8000-000000000001", email: "person@example.com", role: "member" },
      { actorId: "user-1", actorRole: "member", insertInvitation: vi.fn() },
    )).rejects.toThrow("cannot invite that role");
  });
});
