import Link from "next/link";
import { requireAppContext } from "@/lib/app-context";
import { Card, EmptyState, ModuleExplainer, PageIntro, Pill } from "@/components/ui";
import { getModuleGuidance } from "@/features/education/domain/guidance";
import { createAssessmentAction } from "../actions";

export default async function AssessmentsPage({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const { supabase, organisation, membership } = await requireAppContext(); const { message } = await searchParams;
  const { data } = await supabase.from("assessment_sessions").select("id,title,state,revision,updated_at").eq("organisation_id", organisation.id).order("updated_at", { ascending: false });
  return <>
    <PageIntro eyebrow="ASSESSMENT" title="Readiness assessments" body="Answer practical questions about how your organisation works today, and keep the evidence that supports each answer." action={<span style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      <a className="button secondary" href="/api/app/assessment/export?format=xlsx">Export XLSX</a>
      <a className="button secondary" href="/api/app/assessment/export?format=csv">CSV</a>
      {membership.role !== "member" && <form action={createAssessmentAction}><button className="button primary">New assessment</button></form>}
    </span>} />
    {message && <Card style={{ padding: "12px", background: "#fffbef", borderColor: "#efe1aa", marginBottom: "12px" }}>{message}</Card>}
    <details className="section-guide"><summary>How assessments work</summary><ModuleExplainer guidance={getModuleGuidance("assessment")} /></details>
    {data?.length ? (
      <Card aria-label="Readiness assessments">{data.map((item) => <Link style={{ display: "block", padding: "16px 18px", borderTop: "1px solid #edf0f4" }} href={`/app/assessment/${item.id}`} key={item.id}><b>{item.title}</b><span style={{ float: "right", display: "inline-flex", alignItems: "center", gap: "8px" }}><Pill tone={item.state === "completed" ? "green" : "amber"}>{item.state === "completed" ? "Completed" : "In progress"}</Pill><small style={{ color: "#596273" }}>Revision {item.revision}</small></span></Link>)}</Card>
    ) : membership.role === "member" ? <Card style={{ padding: "18px" }}><b>No assessments are available yet</b><p style={{ margin: "6px 0 0", color: "#596273", fontSize: "13px" }}>A workspace operator will need to start one before you can review the answers and evidence.</p></Card> : (
      <EmptyState icon="clipboard" title="Start your first assessment" body="Answer the plain-English readiness catalogue to see exactly where you stand, capture evidence notes as you go, and turn any gaps into risks and tasks. It only takes a few minutes to begin." action={<form action={createAssessmentAction}><button className="button primary">Start your first assessment</button></form>} />
    )}
  </>;
}
