import { PageIntro, Card } from "@/components/ui";
import { acceptInvitationAction } from "../../actions";

export default async function AcceptInvitationPage({ searchParams }: { searchParams: Promise<{ token?: string; message?: string }> }) {
  const { token, message } = await searchParams;
  return <>
    <PageIntro eyebrow="INVITATION" title="Accept invitation" body="The invitation must match the email address on your signed-in account." />
    {message && <Card role="alert" style={{ padding: "12px", background: "#fdf2f2", borderColor: "#f0c9c9", marginBottom: "12px" }}>{message}</Card>}
    <form action={acceptInvitationAction}><input type="hidden" name="token" value={token ?? ""} /><button disabled={!token} className="button primary">Join organisation</button></form>
  </>;
}
