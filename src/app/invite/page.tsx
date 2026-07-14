import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { readInvitationTokenCookie } from "@/lib/invitation-cookie";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { acceptInvitationAction, switchInvitationAccountAction } from "./actions";

export const metadata: Metadata = {
  title: "Workspace invitation — ComplianceHub",
  robots: { index: false, follow: false },
};

const invitationPreviewSchema = z.object({
  organisationName: z.string().trim().min(1).max(160),
  role: z.enum(["admin", "member"]),
  jobTitle: z.string().trim().max(120).nullable(),
  expiresAt: z.string().datetime({ offset: true }),
  emailHint: z.string().trim().min(1).max(320),
  emailMatches: z.boolean(),
});

function UnavailableInvitation() {
  return <main style={{ maxWidth: "600px", margin: "64px auto", padding: "24px" }}>
    <section className="card" style={{ padding: "28px" }}>
      <h1 style={{ fontSize: "24px", letterSpacing: "-.02em" }}>Invitation unavailable</h1>
      <p style={{ marginTop: "10px", color: "#5f6b7a", lineHeight: 1.6 }}>
        This invitation is invalid, expired, revoked, or no longer available. Ask a workspace administrator to request a new invitation.
      </p>
      <Link className="button secondary" style={{ display: "inline-flex", marginTop: "20px" }} href="/sign-in">Go to sign in</Link>
    </section>
  </main>;
}

export default async function InvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  if (status === "unavailable") return <UnavailableInvitation />;

  const rawToken = await readInvitationTokenCookie();
  if (!rawToken) return <UnavailableInvitation />;

  let preview: z.infer<typeof invitationPreviewSchema> | null = null;
  let user: { email?: string; email_confirmed_at?: string | null } | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const [{ data, error }, { data: authData }] = await Promise.all([
      supabase.rpc("invitation_preview", { raw_token: rawToken }),
      supabase.auth.getUser(),
    ]);
    const parsed = invitationPreviewSchema.safeParse(data);
    if (!error && parsed.success) preview = parsed.data;
    user = authData.user;
  } catch {
    return <UnavailableInvitation />;
  }

  if (!preview) return <UnavailableInvitation />;

  const roleLabel = preview.role === "admin" ? "Admin" : "Member";
  const expiresLabel = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(preview.expiresAt));
  const canAccept = Boolean(user?.email_confirmed_at && preview.emailMatches);

  return <main style={{ maxWidth: "640px", margin: "48px auto", padding: "24px" }}>
    <section className="card" style={{ padding: "30px" }}>
      <p style={{ fontSize: "12px", fontWeight: 800, letterSpacing: ".08em", color: "var(--blue)" }}>WORKSPACE INVITATION</p>
      <h1 style={{ marginTop: "8px", fontSize: "26px", letterSpacing: "-.025em" }}>Join {preview.organisationName}</h1>
      <p style={{ marginTop: "10px", color: "#5f6b7a", lineHeight: 1.6 }}>
        You have been invited to collaborate in this ComplianceHub workspace.
      </p>

      <dl style={{ display: "grid", gridTemplateColumns: "minmax(120px, .7fr) 1fr", gap: "12px", marginTop: "24px", padding: "18px", borderRadius: "10px", background: "#f7f9fc" }}>
        <dt style={{ color: "#6d7787" }}>Role</dt><dd style={{ margin: 0, fontWeight: 700 }}>{roleLabel}</dd>
        {preview.jobTitle && <><dt style={{ color: "#6d7787" }}>Job title</dt><dd style={{ margin: 0, fontWeight: 700 }}>{preview.jobTitle}</dd></>}
        <dt style={{ color: "#6d7787" }}>Invited email</dt><dd style={{ margin: 0, fontWeight: 700 }}>{preview.emailHint}</dd>
        <dt style={{ color: "#6d7787" }}>Expires</dt><dd style={{ margin: 0, fontWeight: 700 }}>{expiresLabel} UTC</dd>
      </dl>

      {!user && <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "24px" }}>
        <Link className="button primary" href="/sign-in?next=%2Finvite">Sign in</Link>
        <Link className="button secondary" href="/sign-up?next=%2Finvite">Create account</Link>
      </div>}

      {canAccept && <form action={acceptInvitationAction} style={{ marginTop: "24px" }}>
        <button className="button primary">Join workspace</button>
      </form>}

      {user && !canAccept && <div role="alert" style={{ marginTop: "24px", padding: "14px", borderRadius: "9px", background: "#fff5e8", color: "#7a4b00" }}>
        <p>You are signed in as {user.email ?? "another account"}. Use the invited account before joining this workspace.</p>
        <form action={switchInvitationAccountAction} style={{ marginTop: "12px" }}>
          <button className="button secondary">Switch account</button>
        </form>
      </div>}
    </section>
  </main>;
}
