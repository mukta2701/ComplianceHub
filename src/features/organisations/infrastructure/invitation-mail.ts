import "server-only";

const RESEND_API_ENDPOINT = "https://api.resend.com/emails";
const USER_AGENT = "ComplianceHub/1.0 invitation-mail";

export type InvitationDeliveryOutcome =
  | { status: "sent"; providerMessageId: string }
  | { status: "failed"; error: string }
  | { status: "not_configured" };

type InvitationEmailInput = {
  invitationId: string;
  tokenHash: string;
  recipientEmail: string;
  organisationName: string;
  invitationUrl: string;
};

function safeOrganisationName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) || "your workspace";
}

export async function sendInvitationEmail(input: InvitationEmailInput): Promise<InvitationDeliveryOutcome> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.INVITATION_FROM_EMAIL?.trim();
  if (!apiKey || !from) return { status: "not_configured" };

  const organisationName = safeOrganisationName(input.organisationName);
  let response: Response;
  try {
    response = await fetch(RESEND_API_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "Idempotency-Key": `invitation-${input.invitationId}-${input.tokenHash.slice(0, 16)}`,
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        from,
        to: [input.recipientEmail],
        subject: `You have been invited to ${organisationName} on ComplianceHub`,
        text: `${organisationName} invited you to collaborate in ComplianceHub.\n\nAccept invitation: ${input.invitationUrl}\n\nThis invitation expires in 7 days. If you were not expecting it, you can ignore this email.`,
      }),
    });
  } catch {
    return { status: "failed", error: "Invitation email provider could not be reached." };
  }

  if (!response.ok) {
    return {
      status: "failed",
      error: `Invitation email provider rejected the request (HTTP ${response.status}).`,
    };
  }

  try {
    const payload: unknown = await response.json();
    const providerMessageId = typeof payload === "object" && payload !== null && "id" in payload
      ? (payload as { id?: unknown }).id
      : null;
    if (typeof providerMessageId !== "string" || !providerMessageId.trim()) throw new Error("invalid provider response");
    return { status: "sent", providerMessageId: providerMessageId.slice(0, 255) };
  } catch {
    return { status: "failed", error: "Invitation email provider returned an invalid response." };
  }
}
