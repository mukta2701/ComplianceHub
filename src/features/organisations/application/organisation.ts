import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";

export const organisationInputSchema = z.object({ name: z.string().trim().min(1).max(160) });
export const invitationInputSchema = z.object({
  organisationId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(320),
  role: z.enum(["owner", "member"]).default("member"),
});

export type MembershipRole = "owner" | "member";

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
    insertInvitation: (row: { organisationId: string; email: string; role: MembershipRole; invitedBy: string; tokenHash: string; expiresAt: string }) => Promise<{ id: string }>;
  },
) {
  if (context.actorRole !== "owner") throw new Error("Only organisation owners can invite members");
  const parsed = invitationInputSchema.parse(input);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return context.insertInvitation({ ...parsed, invitedBy: context.actorId, tokenHash, expiresAt });
}
