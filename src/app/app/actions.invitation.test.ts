import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const ORG_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000002";
const INVITE_ID = "30000000-0000-4000-8000-000000000003";

const hoisted = vi.hoisted(() => ({
  ctx: null as unknown,
  enforceRateLimit: vi.fn(),
  sendInvitationEmail: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/app-context", () => ({ requireAppContext: () => Promise.resolve(hoisted.ctx) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: hoisted.enforceRateLimit }));
vi.mock("@/features/organisations/infrastructure/invitation-mail", () => ({ sendInvitationEmail: hoisted.sendInvitationEmail }));
vi.mock("@/lib/site-url", () => ({ siteUrl: () => "https://app.example.com" }));
vi.mock("next/cache", () => ({ revalidatePath: hoisted.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`REDIRECT:${url}`), { digest: "NEXT_REDIRECT" });
  },
}));

import { inviteMemberAction, resendInvitationAction, revokeInvitationAction } from "./actions";

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

function invitationClient() {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "issue_invitation" || name === "resend_invitation") {
      return {
        data: {
          id: INVITE_ID,
          email: "member@example.com",
          role: "member",
          jobTitle: "Developer",
          expiresAt: args.new_expires_at,
        },
        error: null,
      };
    }
    return { data: null, error: null };
  });
  return { rpc };
}

describe("invitation delivery actions", () => {
  beforeEach(() => {
    hoisted.enforceRateLimit.mockReset().mockResolvedValue(undefined);
    hoisted.sendInvitationEmail.mockReset();
    hoisted.revalidatePath.mockReset();
  });

  it("issues atomically, sends the email, records delivery, and never redirects with the raw token", async () => {
    const supabase = invitationClient();
    hoisted.ctx = { supabase, user: { id: USER_ID }, membership: { role: "owner" }, organisation: { id: ORG_ID, name: "Acme" } };
    hoisted.sendInvitationEmail.mockResolvedValue({ status: "sent", providerMessageId: "email_123" });

    const action = inviteMemberAction(form({ email: " MEMBER@example.com ", role: "member", jobTitle: "Developer" }));
    await expect(action).rejects.toThrow(`REDIRECT:/app/settings?inviteStatus=sent&inviteId=${INVITE_ID}`);

    expect(hoisted.enforceRateLimit).toHaveBeenCalledWith(`invite:${USER_ID}`, { limit: 10, windowMs: 60 * 60_000 });
    const issue = supabase.rpc.mock.calls.find(([name]) => name === "issue_invitation");
    expect(issue?.[1]).toMatchObject({
      target_organisation_id: ORG_ID,
      target_email: "member@example.com",
      target_role: "member",
      target_job_title: "Developer",
      new_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      new_expires_at: expect.any(String),
    });
    const mail = hoisted.sendInvitationEmail.mock.calls[0][0];
    expect(mail).toMatchObject({ invitationId: INVITE_ID, recipientEmail: "member@example.com", organisationName: "Acme" });
    expect(mail.invitationUrl).toMatch(/^https:\/\/app\.example\.com\/invite\/[A-Za-z0-9_-]{43}$/);
    const rawToken = mail.invitationUrl.split("/").at(-1);
    expect(createHash("sha256").update(rawToken).digest("hex")).toBe(mail.tokenHash);
    expect(String(await action.catch((error) => error.message))).not.toContain(rawToken);
    expect(supabase.rpc).toHaveBeenCalledWith("record_invitation_delivery", {
      target_invitation_id: INVITE_ID,
      issued_token_hash: mail.tokenHash,
      new_delivery_status: "sent",
      new_provider_message_id: "email_123",
      new_delivery_error: null,
    });
  });

  it("retains a failed invitation and records a safe delivery failure for retry", async () => {
    const supabase = invitationClient();
    hoisted.ctx = { supabase, user: { id: USER_ID }, membership: { role: "admin" }, organisation: { id: ORG_ID, name: "Acme" } };
    hoisted.sendInvitationEmail.mockResolvedValue({ status: "failed", error: "Invitation email provider could not be reached." });

    await expect(inviteMemberAction(form({ email: "member@example.com", role: "member" })))
      .rejects.toThrow(`REDIRECT:/app/settings?inviteStatus=failed&inviteId=${INVITE_ID}`);

    expect(supabase.rpc.mock.calls.map(([name]) => name)).toEqual(["issue_invitation", "record_invitation_delivery"]);
    expect(supabase.rpc).toHaveBeenLastCalledWith("record_invitation_delivery", expect.objectContaining({
      target_invitation_id: INVITE_ID,
      new_delivery_status: "failed",
      new_delivery_error: "Invitation email provider could not be reached.",
    }));
  });

  it("rotates the token through the resend RPC before retrying delivery", async () => {
    const supabase = invitationClient();
    hoisted.ctx = { supabase, user: { id: USER_ID }, membership: { role: "owner" }, organisation: { id: ORG_ID, name: "Acme" } };
    hoisted.sendInvitationEmail.mockResolvedValue({ status: "not_configured" });

    await expect(resendInvitationAction(form({ invitationId: INVITE_ID })))
      .rejects.toThrow(`REDIRECT:/app/settings?inviteStatus=not_configured&inviteId=${INVITE_ID}`);

    expect(hoisted.enforceRateLimit).toHaveBeenCalledWith(`invite-resend:${USER_ID}`, { limit: 10, windowMs: 60 * 60_000 });
    const resend = supabase.rpc.mock.calls.find(([name]) => name === "resend_invitation");
    expect(resend?.[1]).toEqual({
      target_invitation_id: INVITE_ID,
      new_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      new_expires_at: expect.any(String),
    });
    const mail = hoisted.sendInvitationEmail.mock.calls[0][0];
    const rawToken = mail.invitationUrl.split("/").at(-1);
    expect(createHash("sha256").update(rawToken).digest("hex")).toBe(resend?.[1].new_token_hash);
    expect(supabase.rpc).toHaveBeenLastCalledWith("record_invitation_delivery", expect.objectContaining({
      issued_token_hash: resend?.[1].new_token_hash,
      new_delivery_status: "not_configured",
      new_delivery_error: "Invitation email delivery is not configured.",
    }));
  });

  it("revokes by immutable invitation id through the lifecycle RPC", async () => {
    const supabase = invitationClient();
    hoisted.ctx = { supabase, user: { id: USER_ID }, membership: { role: "admin" }, organisation: { id: ORG_ID, name: "Acme" } };

    await expect(revokeInvitationAction(form({ invitationId: INVITE_ID }))).resolves.toBeUndefined();

    expect(supabase.rpc).toHaveBeenCalledWith("revoke_invitation", { target_invitation_id: INVITE_ID });
    expect(hoisted.revalidatePath).toHaveBeenCalledWith("/app/settings");
  });
});
