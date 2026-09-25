import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAppContext } from "@/lib/app-context";
import { Card, PageIntro } from "@/components/ui";
import { createAdditionalOrganisationAction } from "../../actions";

export const metadata = { title: "Create organisation" };

export default async function NewOrganisationPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { membership } = await requireAppContext();
  if (membership.role !== "owner") redirect("/app");
  const { message } = await searchParams;
  return <>
    <Link href="/app">← Back to workspace</Link>
    <PageIntro
      eyebrow="WORKSPACES"
      title="Create a new organisation"
      body="Each organisation is a separate workspace. Assessments, risks, evidence and exports stay in the workspace where they were created, and your current workspace is left untouched."
    />
    {message && <Card role="alert" style={{ padding: "12px", background: "#fdf2f2", borderColor: "#f0c9c9", marginBottom: "12px" }}>{message}</Card>}
    <form action={createAdditionalOrganisationAction} className="card app-form">
      <label>Organisation name<input name="name" required maxLength={160} autoFocus placeholder="Second Ltd" /></label>
      <p style={{ margin: 0, color: "#596273", fontSize: "13px", lineHeight: 1.5 }}>
        You will be added as Owner of the new workspace and switched into it.
        Your existing workspaces remain available from the account menu.
      </p>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button className="button primary">Create organisation</button>
        <Link className="button secondary" href="/app">Cancel</Link>
      </div>
    </form>
  </>;
}
