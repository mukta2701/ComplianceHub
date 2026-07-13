import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { canInviteRole, membershipRoles, type MembershipRole } from "../domain/access";

export const organisationInputSchema = z.object({ name: z.string().trim().min(1).max(160) });
export const invitationInputSchema = z.object({
  organisationId: z.uuid(),
  email: z.string().trim().toLowerCase().email().max(320),
  role: z.enum(membershipRoles).default("member"),
  jobTitle: z.string().trim().min(1).max(120).optional(),
});
export type { MembershipRole } from "../domain/access";

function slugify(name: string) {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || `organisation-${randomBytes(4).toString("hex")}`;
}

export async function createOrganisation(
  input: unknown,
  context: { userId: string; insert: (row: { name: string; slug: string; createdBy: string }) => Promise<{ id: string; name: string; slug: string }> },
) {
  const parsed = organisationInputSchema.parse(input);
  return context.insert({ name: parsed.name, slug: slugify(parsed.name), createdBy: context.userId });
}

export async function inviteMember(
  input: unknown,
  context: {
    actorId: string;
    actorRole: MembershipRole;
    insertInvitation: (row: { organisationId: string; email: string; role: MembershipRole; jobTitle?: string; invitedBy: string; tokenHash: string; expiresAt: string }) => Promise<{ id: string }>;
  },
) {
  const parsed = invitationInputSchema.parse(input);
  if (!canInviteRole(context.actorRole, parsed.role)) throw new Error("Your role cannot invite that role");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const invitation = await context.insertInvitation({ ...parsed, invitedBy: context.actorId, tokenHash, expiresAt });
  return { ...invitation, token };
}
