import { createOrganisationAction } from "../actions";
import { PageIntro, Card } from "@/components/ui";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { message } = await searchParams;
  return <>
    <PageIntro eyebrow="WORKSPACE SETUP" title="Create your organisation" body="Assessment answers, risks, evidence and exports are isolated to this organisation." />
    {message && <Card role="alert" style={{ padding: "12px", background: "#fdf2f2", borderColor: "#f0c9c9", marginBottom: "12px" }}>{message}</Card>}
    <form action={createOrganisationAction} className="card app-form">
      <label>Organisation name<input name="name" required maxLength={160} autoFocus placeholder="Example Ltd" /></label>
      <button className="button primary">Create workspace</button>
    </form>
  </>;
}
