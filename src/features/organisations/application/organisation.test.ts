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

  it("only permits owners to invite a normalised email address", async () => {
    const insertInvitation = vi.fn().mockResolvedValue({ id: "invite-1" });
    await expect(inviteMember(
      { organisationId: "00000000-0000-4000-8000-000000000001", email: " PERSON@Example.COM ", role: "member" },
      { actorId: "user-1", actorRole: "owner", insertInvitation },
    )).resolves.toEqual({ id: "invite-1", token: expect.any(String) });
    expect(insertInvitation).toHaveBeenCalledWith(expect.objectContaining({ email: "person@example.com", invitedBy: "user-1" }));
  });

  it("rejects member-created invitations", async () => {
    await expect(inviteMember(
      { organisationId: "00000000-0000-4000-8000-000000000001", email: "person@example.com", role: "member" },
      { actorId: "user-1", actorRole: "member", insertInvitation: vi.fn() },
    )).rejects.toThrow("Only organisation owners");
  });
});
